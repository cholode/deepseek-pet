import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DiaryService } from '../src/main/diary/service';
import { CompanionStore } from '../src/main/companion/store';
import { appendDiary, automaticDiaryMarker } from '../src/main/diary/files';
import { diaryDueDate, diaryWaitingDays, diaryWakeDelay, shiftDiaryDay } from '../src/companion/diary-schedule';
import { diaryMaterial } from '../src/companion/diary';
import type { ModelPort } from '../src/companion/ports';
import type { CompanionEvent } from '../src/shared/companion';

const directories: string[] = [], services: DiaryService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); await Promise.all(directories.splice(0).map(d => fs.rm(d, { recursive: true, force: true }))); });
const at = (day: string, time = '20:00:00') => new Date(`${day}T${time}`).getTime();
const event = (day: string, text: string): CompanionEvent => ({ id: text, at: at(day), text, actor: 'user', source: 'desktop', conversationId: 'desktop' });
async function fixture(initial = at('2026-10-26'), model?: ModelPort) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-auto-diary-')); directories.push(home);
  const root = path.join(home, 'project'), settings = path.join(home, 'profile', 'diary-settings.json'), scheduleFile = path.join(home, 'profile', 'diary-schedule.json');
  const data = new CompanionStore(path.join(home, 'companion.json'), initial).data;
  data.config.enabled = true; data.config.model.model = 'fixture'; data.events = [event('2026-10-26', '周一调好了界面')];
  const clock = { now: initial, chatBusy: false };
  const complete = vi.fn<ModelPort['complete']>().mockImplementation(async messages => {
    const material = JSON.parse(messages[1].content!);
    return { text: `${material.date}：${material.events.map((e: { text: string }) => e.text).join('，')}`, calls: [] };
  });
  const host = { now: () => clock.now, data: () => data, chatBusy: () => clock.chatBusy, changed: vi.fn(), chooseDirectory: async () => undefined, openDirectory: async () => {} };
  const create = async () => { const service = new DiaryService(settings, root, model ?? { complete }, host); services.push(service); await service.start(); return service; };
  const service = await create();
  return { home, root, settings, scheduleFile, data, clock, complete, host, service, create };
}

describe('每天21点与启动补写', () => {
  it('21点之前只补前一天，21点起包含当天，跨月/跨年按本地日历推进', () => {
    expect(diaryDueDate(at('2026-10-26', '20:59:59'))).toBe('2026-10-25');
    expect(diaryDueDate(at('2026-10-26', '21:00:00'))).toBe('2026-10-26');
    expect(shiftDiaryDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDiaryDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(diaryWaitingDays('2026-10-26', at('2026-10-29'))).toBe(3);
    expect(diaryWakeDelay('2026-10-26', 0, at('2026-10-26', '20:59:50'))).toBe(10000);
  });
  it('恰好21点生成一次；重复检查、重启与时钟倒退都不重复', async () => {
    const f = await fixture(); await f.service.tickAutomatic(); expect(f.complete).not.toHaveBeenCalled();
    f.clock.now = at('2026-10-26', '21:00:00'); await f.service.tickAutomatic();
    expect(f.service.view().automatic.lastWrittenDate).toBe('2026-10-26'); await f.service.tickAutomatic();
    await f.service.close(); const next = await f.create(); await next.tickAutomatic();
    f.clock.now = at('2026-10-26', '19:00:00'); await next.tickAutomatic();
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect((await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8')).split(automaticDiaryMarker('2026-10-26'))).toHaveLength(2);
  });
  it('当天21点前退出，下次启动逐日补齐；无记录日不编造也不请求模型', async () => {
    const f = await fixture(); await f.service.close();
    f.clock.now = at('2026-10-29', '10:00:00');
    f.data.events.push(event('2026-10-28', '周三玩了游戏'), { ...event('2026-10-29', '周四的新事'), at: at('2026-10-29', '09:00:00') });
    const next = await f.create(); expect(next.view().automatic.waitingDays).toBe(3);
    for (let i = 0; i < 4; i++) await next.tickAutomatic();
    expect(next.view().automatic.nextDate).toBe('2026-10-29'); expect(next.view().automatic.waitingDays).toBe(0); expect(f.complete).toHaveBeenCalledTimes(2);
    const monday = await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8');
    const tuesday = await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-27.md'), 'utf8');
    expect(monday).toContain('周一调好了界面'); expect(monday).not.toContain('周四的新事'); expect(monday).toContain('自动补记');
    expect(tuesday).toContain('没有找到这一天保留下来的桌面对话');
    expect(diaryMaterial(f.data, f.clock.now, '2026-10-26').mood).toBeUndefined();
    expect(await fs.readdir(f.root)).toHaveLength(3);
  });
  it('第一次在21点后启动会写当天，不凭空追溯启用前的日子', async () => {
    const f = await fixture(at('2026-10-26', '22:00:00')); await f.service.tickAutomatic();
    expect(f.service.view().automatic.startedDate).toBe('2026-10-26'); expect(f.service.view().files.map(file => file.date)).toEqual(['2026-10-26']);
  });
  it('自动日记与手动记录可共存，切换目录后不会重写以前完成的日期', async () => {
    const f = await fixture(); await f.service.request({ type: 'write' });
    f.clock.now = at('2026-10-26', '21:00:00'); await f.service.tickAutomatic();
    const original = await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8'); expect(original.match(/^## /gm)).toHaveLength(2);
    const target = path.join(f.home, '新的日记'); await f.service.request({ type: 'set-directory', directory: target }); await f.service.tickAutomatic(); expect(await fs.readdir(target)).toEqual([]);
    f.clock.now = at('2026-10-27', '21:00:00'); await f.service.tickAutomatic();
    expect(await fs.readdir(target)).toEqual(['大肥鱼日记-2026-10-27.md']);
    expect(await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8')).toBe(original);
  });
  it('模型失败不推进日期，15分钟退避跨重启生效，之后重试成功', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); f.complete.mockRejectedValueOnce(new Error('网络断开'));
    await f.service.tickAutomatic(); expect(f.service.view().automatic.nextDate).toBe('2026-10-26'); expect(f.service.view().automatic.error).toContain('网络断开');
    await f.service.close(); const next = await f.create(); f.clock.now += 60000; await next.tickAutomatic(); expect(f.complete).toHaveBeenCalledTimes(1);
    f.clock.now += 14 * 60000; await next.tickAutomatic(); expect(f.complete).toHaveBeenCalledTimes(2); expect(next.view().automatic.error).toBeUndefined();
    expect(next.view().automatic.lastWrittenDate).toBe('2026-10-26');
  });
  it('磁盘路径不可写时不调用模型，更换可写地址后继续补记', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); await fs.writeFile(f.root, '这里是文件');
    await f.service.tickAutomatic(); expect(f.complete).not.toHaveBeenCalled(); expect(f.service.view().automatic.waitingDays).toBe(1);
    await f.service.request({ type: 'set-directory', directory: path.join(f.home, '可写') }); await f.service.tickAutomatic();
    expect(f.complete).toHaveBeenCalledTimes(1); expect(f.service.view().automatic.waitingDays).toBe(0);
  });
  it('文件已写但进度未提交的崩溃窗口，重启按标记恢复且不再调用模型', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); await f.service.close();
    const schedule = JSON.parse(await fs.readFile(f.scheduleFile, 'utf8'));
    schedule.pending = { date: '2026-10-26', directory: f.root, entry: '已经生成的正文' };
    await fs.writeFile(f.scheduleFile, JSON.stringify(schedule));
    const original = await appendDiary(f.root, '2026-10-26', schedule.pending.entry, new AbortController().signal, true);
    const next = await f.create(); await next.request({ type: 'set-directory', directory: path.join(f.home, '换过的目录') }); await next.tickAutomatic();
    expect(f.complete).not.toHaveBeenCalled(); expect(next.view().automatic.lastWrittenDate).toBe('2026-10-26');
    expect(await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8')).toBe(original);
    expect(await fs.readdir(path.join(f.home, '换过的目录'))).toEqual([]);
  });
  it('生成完但尚未提交的正文可恢复，换地址后续写，不重复请求模型', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); await f.service.close();
    const schedule = JSON.parse(await fs.readFile(f.scheduleFile, 'utf8'));
    schedule.pending = { date: '2026-10-26', directory: f.root, entry: '生成后退出时保留的正文' }; await fs.writeFile(f.scheduleFile, JSON.stringify(schedule));
    const next = await f.create(), target = path.join(f.home, '恢复到这里'); await next.request({ type: 'set-directory', directory: target }); await next.tickAutomatic();
    expect(f.complete).not.toHaveBeenCalled(); expect(await fs.readFile(path.join(target, '大肥鱼日记-2026-10-26.md'), 'utf8')).toContain('生成后退出时保留的正文');
    expect(JSON.parse(await fs.readFile(f.scheduleFile, 'utf8')).pending).toBeUndefined();
  });
  it('用户取消自动生成后保留待办，迟到响应不落盘也不立即循环重试', async () => {
    let resolve!: (value: { text: string; calls: [] }) => void, entered!: () => void;
    const arrival = new Promise<void>(r => { entered = r; });
    const complete = vi.fn<ModelPort['complete']>().mockImplementation(async () => { entered(); return new Promise(r => { resolve = r; }); });
    const f = await fixture(at('2026-10-26', '21:00:00'), { complete });
    const running = f.service.tickAutomatic(); await arrival; await f.service.tickAutomatic(); expect(complete).toHaveBeenCalledTimes(1);
    f.service.cancel(); resolve({ text: '迟到的结果', calls: [] }); await running;
    await f.service.tickAutomatic(); expect(complete).toHaveBeenCalledTimes(1); expect(f.service.view().automatic.waitingDays).toBe(1); expect(await fs.readdir(f.root)).toEqual([]);
  });
  it('聊天期间与休眠期间让出执行，恢复后补上；关闭后不会再触发', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); f.clock.chatBusy = true; await f.service.tickAutomatic(); expect(f.complete).not.toHaveBeenCalled();
    f.clock.chatBusy = false; f.service.suspend(); await f.service.tickAutomatic(); expect(f.complete).not.toHaveBeenCalled();
    f.service.resume(); await f.service.tickAutomatic(); expect(f.complete).toHaveBeenCalledTimes(1);
    await f.service.close(); f.clock.now = at('2026-10-27', '21:00:00'); await f.service.tickAutomatic(); expect(f.service.view().automatic.lastWrittenDate).toBe('2026-10-26');
  });
  it('真实后台定时器能够触发补写，无需打开日记页或手动调用检查', async () => {
    const f = await fixture(at('2026-10-26', '21:00:00')); f.service.startAutomatic();
    await vi.waitFor(() => expect(f.service.view().automatic.lastWrittenDate).toBe('2026-10-26'), { timeout: 3000 });
    expect(f.complete).toHaveBeenCalledTimes(1);
  });
  it('休眠中断的响应在恢复后才返回，也会立即续写而非错误退避15分钟', async () => {
    let finish!: (value: { text: string; calls: [] }) => void, entered!: () => void;
    const arrival = new Promise<void>(r => { entered = r; });
    const complete = vi.fn<ModelPort['complete']>().mockImplementationOnce(async () => { entered(); return new Promise(r => { finish = r; }); })
      .mockResolvedValue({ text: '恢复后重新写好的日记', calls: [] });
    const f = await fixture(at('2026-10-26', '21:00:00'), { complete });
    const running = f.service.tickAutomatic(); await arrival;
    f.service.suspend(); f.service.resume(); finish({ text: '已中断的正文', calls: [] }); await running;
    expect(f.service.view().automatic.retryAt).toBe(0);
    await f.service.tickAutomatic(); expect(f.service.view().automatic.lastWrittenDate).toBe('2026-10-26');
    expect(await fs.readFile(path.join(f.root, '大肥鱼日记-2026-10-26.md'), 'utf8')).not.toContain('已中断的正文');
  });
});
