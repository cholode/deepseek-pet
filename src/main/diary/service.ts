import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CompanionData } from '../../shared/companion';
import { diaryDay, diaryRequestSchema, diarySettingsSchema, type DiaryRequest, type DiaryResponse, type DiaryView } from '../../shared/diary';
import type { ModelPort } from '../../companion/ports';
import { diaryMaterial, diaryMessages, localDiary } from '../../companion/diary';
import { diaryDueDate, diaryWaitingDays, diaryWakeDelay } from '../../companion/diary-schedule';
import { absoluteDirectory, appendDiary, listDiaries, readAutomaticDiary, readDiary, writableDirectory } from './files';
import { DiaryScheduleStore } from './schedule-store';

interface DiaryHost {
  now(): number; data(): CompanionData; changed(state: DiaryView): void;
  chatBusy?(): boolean;
  chooseDirectory(current: string): Promise<string | undefined>; openDirectory(directory: string): Promise<void>;
}
// 独立服务与配置，写日记不改聊天上下文、长期记忆、心情或 MCP 授权。
export class DiaryService {
  private setting = { directory: '' }; private state: DiaryView; private active?: AbortController;
  private operation?: Promise<DiaryResponse>; private closed = false;
  private schedule: DiaryScheduleStore; private timer?: ReturnType<typeof setTimeout>;
  private automaticEnabled = false; private suspended = false; private writingDate?: string;
  private cancelReason?: 'user' | 'suspend' | 'close';
  constructor(private settingsFile: string, defaultDirectory: string, private model: ModelPort, private host: DiaryHost) {
    this.schedule = new DiaryScheduleStore(path.join(path.dirname(settingsFile), 'diary-schedule.json'), host.now());
    this.state = { directory: defaultDirectory, defaultDirectory, customDirectory: false, busy: false, files: [], content: '', automatic: this.automaticView() };
  }
  async start() {
    try {
      this.setting = diarySettingsSchema.parse(JSON.parse(await fs.readFile(this.settingsFile, 'utf8')));
      if (this.setting.directory) this.setting.directory = absoluteDirectory(this.setting.directory);
    } catch (e) {
      this.setting = { directory: '' };
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.rename(this.settingsFile, `${this.settingsFile}.corrupt-${Date.now()}`);
        this.state.notice = '日记位置配置损坏，已备份并恢复默认位置；原日记未移动。';
      }
    }
    this.state.directory = this.setting.directory || this.state.defaultDirectory;
    this.state.customDirectory = Boolean(this.setting.directory);
    try { await this.refresh(); } catch { this.state.notice = '日记目录暂时无法读取，请检查或更换保存位置。'; }
    await this.schedule.load();
  }
  private automaticView(): DiaryView['automatic'] {
    const s = this.schedule.state;
    return { time: '21:00', startedDate: s.startedDate, nextDate: s.nextDate, lastWrittenDate: s.lastWrittenDate,
      waitingDays: diaryWaitingDays(s.nextDate, this.host.now()), retryAt: s.retryAt, writingDate: this.writingDate, error: s.error };
  }
  view() { return structuredClone({ ...this.state, automatic: this.automaticView() }); }
  private publish() { if (!this.closed) this.host.changed(this.view()); }
  // 加载存储与启动时钟分开，避免启动流程被补写模型请求阻塞，也方便用注入时钟验证边界。
  startAutomatic() { this.automaticEnabled = true; this.arm(0); }
  private arm(delay = diaryWakeDelay(this.schedule.state.nextDate, this.schedule.state.retryAt, this.host.now())) {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed || this.suspended || !this.automaticEnabled) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tickAutomatic().finally(() => this.arm()); }, delay);
    this.timer.unref();
  }
  async tickAutomatic() {
    const now = this.host.now(), s = this.schedule.state;
    if (this.closed || this.suspended || this.operation || this.host.chatBusy?.() || s.nextDate > diaryDueDate(now) || s.retryAt > now) return;
    await this.run({ type: 'automatic', date: s.nextDate });
  }
  request(raw: unknown): Promise<DiaryResponse> {
    const request = diaryRequestSchema.parse(raw);
    if (request.type === 'state') return Promise.resolve({ ok: true, state: this.view() });
    if (request.type === 'cancel') { this.cancel(); return Promise.resolve({ ok: true, state: this.view() }); }
    if (this.closed || this.operation) return Promise.resolve({ ok: false, message: '日记正在处理，请稍候', state: this.view() });
    return this.run(request);
  }
  private run(request: DiaryRequest | { type: 'automatic'; date: string }) {
    this.cancelReason = undefined;
    this.writingDate = request.type === 'automatic' ? request.date : undefined;
    this.state.busy = true; this.state.notice = undefined; this.publish();
    this.active = new AbortController();
    const operation = this.perform(request, this.active.signal);
    this.operation = operation;
    void operation.finally(() => { this.operation = undefined; });
    return operation;
  }
  private async perform(request: DiaryRequest | { type: 'automatic'; date: string }, signal: AbortSignal): Promise<DiaryResponse> {
    let message: string | undefined; let ok = true;
    try {
      if (request.type === 'write') await this.write(signal);
      else if (request.type === 'automatic') await this.writeAutomatic(request.date, signal);
      else if (request.type === 'refresh') await this.refresh();
      else if (request.type === 'read') { const content = await readDiary(this.state.directory, request.date); this.state.content = content; this.state.selectedDate = request.date; }
      else if (request.type === 'set-directory') await this.configure(request.directory);
      else if (request.type === 'choose-directory') { const directory = await this.host.chooseDirectory(this.state.directory); if (directory) await this.configure(directory); }
      else if (request.type === 'open-directory') { await writableDirectory(this.state.directory); await this.host.openDirectory(this.state.directory); }
    } catch (e) {
      ok = false; message = signal.aborted ? (request.type === 'automatic' ? '已停止自动写作，稍后会检查并续写。' : '已停止写日记，未完成的正文没有保存。') : `日记操作失败：${e instanceof Error ? e.message : '请检查保存目录'}`;
      this.state.notice = message;
      if (request.type === 'automatic') {
        // 用户停止或网络/磁盘失败时保留这个日期，15分钟后重试；休眠/退出中断在恢复时直接续写。
        const retryAt = this.cancelReason === 'suspend' || this.cancelReason === 'close' ? 0 : this.host.now() + 15 * 60000;
        try { await this.schedule.save({ ...this.schedule.state, retryAt, error: `${request.date}：${message}`.slice(0, 2000) }); }
        catch {
          // 进度盘不可写时仍在内存退避，避免每秒重新请求模型。
          this.schedule.state = { ...this.schedule.state, retryAt, error: `${request.date}：${message}`.slice(0, 2000) };
          this.state.notice += ' 自动进度暂时无法保存，下次启动会重新检查。';
        }
      }
    } finally { this.active = undefined; this.writingDate = undefined; this.state.busy = false; this.publish(); }
    return { ok, message, state: this.view() };
  }
  private async refresh() {
    this.state.files = await listDiaries(this.state.directory);
    if (!this.state.files.some(f => f.date === this.state.selectedDate)) {
      this.state.selectedDate = undefined; this.state.content = '';
    }
  }
  private async configure(value: string) {
    const directory = await writableDirectory(value || this.state.defaultDirectory);
    const setting = { directory: value ? directory : '' };
    await fs.mkdir(path.dirname(this.settingsFile), { recursive: true });
    const temp = `${this.settingsFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(setting, null, 2)); await fs.rename(temp, this.settingsFile);
    this.setting = setting; this.state.directory = directory; this.state.customDirectory = Boolean(value);
    this.state.selectedDate = undefined; this.state.content = '';
    await this.refresh(); this.state.notice = '保存位置已设置。旧目录里的日记保留原位。';
    await this.schedule.save({ ...this.schedule.state, retryAt: 0, error: undefined });
    this.arm(0);
  }
  private async entry(date: string, signal: AbortSignal, automatic: boolean, now: number) {
    const data = structuredClone(this.host.data());
    // 离线多日且无资料时诚实留一页记录，不为每个空白日消耗模型请求。
    const intelligent = data.config.enabled && Boolean(data.config.model.model.trim()) && (!automatic || diaryMaterial(data, now, date).events.length > 0);
    let text: string;
    if (intelligent) {
      const result = await this.model.complete(diaryMessages(data, now, date), data.config.model, signal);
      signal.throwIfAborted();
      text = result.text.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (result.calls.length || !text || text.length > 12000) throw new Error('模型没有返回有效日记正文，请重试；已有日记保持不变');
    } else text = localDiary(data, now, date);
    signal.throwIfAborted();
    const time = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });
    const kind = automatic ? (date === diaryDay(now) ? '自动日记' : '自动补记') : '手动记录';
    return `## ${diaryDay(now)} ${time} · ${kind} · ${intelligent ? '智能日记' : '本地纪事'}\n\n${text}\n\n_依据：当前保留的${date}桌面对话；不包含 QQ 对话。_`;
  }
  private async write(signal: AbortSignal) {
    const now = this.host.now(), date = diaryDay(now), directory = this.state.directory;
    await writableDirectory(directory); signal.throwIfAborted();
    const content = await appendDiary(directory, date, await this.entry(date, signal, false, now), signal);
    this.saved(directory, date, content);
  }
  private async writeAutomatic(date: string, signal: AbortSignal) {
    const pending = this.schedule.state.pending;
    // 检查上次提交所在目录；即使用户后来换了位置，也不会把已经落盘的日记再写一份。
    const previousDirectory = pending?.directory ?? this.state.directory;
    const existing = await readAutomaticDiary(previousDirectory, date);
    if (existing !== undefined) {
      await this.schedule.complete(date); this.saved(previousDirectory, date, existing); return;
    }
    const directory = this.state.directory;
    await writableDirectory(directory); signal.throwIfAborted();
    await this.schedule.save(this.schedule.state);
    const entry = pending?.entry ?? await this.entry(date, signal, true, this.host.now());
    signal.throwIfAborted();
    await this.schedule.save({ ...this.schedule.state, pending: { date, directory, entry }, retryAt: 0, error: undefined });
    const content = await appendDiary(directory, date, entry, signal, true);
    // 标记与正文原子落盘，然后推进进度；若最后一步失败，下一次根据正文标记恢复。
    await this.schedule.complete(date);
    this.saved(directory, date, content);
  }
  private saved(directory: string, date: string, content: string) {
    // 文件提交后不再把后续刷新失败误报为“未保存”，避免用户重试造成重复条目。
    if (directory === this.state.directory) {
      this.state.selectedDate = date; this.state.content = content;
      this.state.files = [{ date, name: `大肥鱼日记-${date}.md` }, ...this.state.files.filter(f => f.date !== date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
    }
    this.state.notice = `已保存到 ${path.join(directory, `大肥鱼日记-${date}.md`)}`;
  }
  cancel() { this.cancelReason = 'user'; this.active?.abort(); }
  suspend() { this.suspended = true; if (this.timer) clearTimeout(this.timer); this.cancelReason = 'suspend'; this.active?.abort(); }
  resume() { this.suspended = false; this.arm(0); }
  async close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.cancelReason = 'close'; this.active?.abort(); await this.operation; }
}
