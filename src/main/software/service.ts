import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { softwareRequestSchema, softwareStoreSchema, type SoftwareEntry, type SoftwareEntryView, type SoftwareRequest, type SoftwareResponse, type SoftwareView } from '../../shared/software';
import type { ToolDefinition, ToolPort } from '../../companion/ports';
import { SoftwarePlugins, softwareDirectory } from './plugins';
import { SoftwareConnection, runtimeExecutable, softwareToolName } from './connection';
import { endpoint } from '../companion/http';

export interface SoftwareHost {
  changed(state: SoftwareView): void; cancelChat(): void;
  choose(kind: 'directory' | 'runtime' | 'plugin', current: string): Promise<string | undefined>;
  seal(value: string): Promise<string>; unseal(value: string): Promise<string>;
  bundled?: { id: string; name: string; directory: string }[];
  canRemind?(): boolean; remind?(text: string): void;
  operating?(active: boolean): void;
}
export function pluginResult(raw: string): unknown {
  const result = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('插件未返回可读取的数据');
  return JSON.parse(text);
}
export function learningRecordResult(raw: string): string {
  const result = pluginResult(raw);
  if (!result || typeof result !== 'object' || !('recorded' in result) || result.recorded !== true) throw new Error('学习插件没有确认记录成功，请核查外部记录');
  return JSON.stringify(result);
}
export class SoftwareService implements ToolPort {
  readonly plugins: SoftwarePlugins;
  private entries: SoftwareEntry[] = [];
  private sessions = new Map<string, SoftwareConnection>();
  private statuses = new Map<string, { status: SoftwareEntryView['status']; error?: string }>();
  private connections = new Map<string, Promise<SoftwareConnection>>();
  private activities: SoftwareView['activities'] = [];
  private writing = Promise.resolve(); private busy = false; private closed = false; private notice?: string;
  private lifecycle = new AbortController(); private invoking = false;
  private file: string;
  private reminderTimer?: ReturnType<typeof setInterval>;
  private polling = false;
  constructor(directory: string, private host: SoftwareHost) { this.file = path.join(directory, 'software.json'); this.plugins = new SoftwarePlugins(path.join(directory, 'software-plugins')); }
  async start() {
    await this.plugins.load();
    try {
      if ((await fs.stat(this.file)).size > 8 * 1024 * 1024) throw new Error('软件配置过大');
      this.entries = softwareStoreSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8'))).entries;
      if (new Set(this.entries.map(e => e.id)).size !== this.entries.length) throw new Error('软件 ID 重复');
    } catch (e) {
      this.entries = [];
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`); this.notice = '软件配置损坏，已备份；请重新添加软件'; }
    }
    for (const entry of this.entries) if (this.plugins.records.get(entry.pluginId)?.fingerprint !== entry.fingerprint) {
      entry.enabled = false; entry.grants = []; entry.tools = []; this.statuses.set(entry.id, { status: 'error', error: '关联插件缺失或已变化，请重新绑定' });
    }
    this.notice ??= this.plugins.warnings.join('；') || undefined;
    if (this.host.remind) this.reminderTimer = setInterval(() => { void this.pollReminders(); }, 60000);
  }
  view(): SoftwareView {
    return structuredClone({ bundled: this.host.bundled?.map(({ id, name }) => ({ id, name })), plugins: [...this.plugins.records.values()].map(({ manifest, fingerprint }) => ({ manifest, fingerprint })),
      entries: this.entries.map(({ sealedToken, ...e }) => ({ ...e, hasToken: Boolean(sealedToken), ...(this.statuses.get(e.id) ?? { status: 'disconnected' as const }) })), busy: this.busy, notice: this.notice, activities: this.activities });
  }
  private publish() { if (!this.closed) this.host.changed(this.view()); }
  private persist() {
    const text = JSON.stringify(softwareStoreSchema.parse({ version: 1, entries: this.entries }), null, 2);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('软件配置过大');
    const operation = this.writing.then(async () => { await fs.writeFile(`${this.file}.tmp`, text, 'utf8'); await fs.rename(`${this.file}.tmp`, this.file); });
    this.writing = operation.catch(() => {}); return operation;
  }
  private entry(id: string) { const entry = this.entries.find(e => e.id === id); if (!entry) throw new Error('软件不存在'); return entry; }
  async request(raw: unknown): Promise<SoftwareResponse> {
    const request = softwareRequestSchema.parse(raw);
    if (request.type === 'state') return { ok: true, state: this.view() };
    // 声明式设置页只能调用清单列出的两项工具，仍经过同一逐项授权入口。
    if (request.type === 'configure-plugin') {
      try {
        const entry = this.entry(request.id), config = this.plugins.records.get(entry.pluginId)?.manifest.configuration;
        if (!config) throw new Error('此插件未提供设置页');
        const raw = await this.call(softwareToolName(entry.id, request.operation === 'read' ? config.readTool : config.writeTool), request.operation === 'read' ? {} : { settings: request.settings ?? {} }, this.lifecycle.signal);
        return { ok: true, result: pluginResult(raw), state: this.view() };
      } catch (e) { return { ok: false, message: e instanceof Error ? e.message : '插件设置失败', state: this.view() }; }
    }
    if (request.type === 'stop') {
      this.host.cancelChat(); this.lifecycle.abort(); this.lifecycle = new AbortController();
      for (const entry of this.entries) entry.enabled = false;
      await this.disconnectAll();
      try { await this.persist(); this.notice = '已停用所有软件，后续调用已停止；需要时可重新连接'; return { ok: true, state: this.view() }; }
      catch { this.notice = '本次已停止，但停用状态未能保存，请检查配置目录'; return { ok: false, message: this.notice, state: this.view() }; }
      finally { this.publish(); }
    }
    if (this.busy || this.closed) return { ok: false, message: '软件管理正在处理，请稍候', state: this.view() };
    this.busy = true; this.notice = undefined; this.publish();
    const signal = this.lifecycle.signal;
    try { const selectedPath = await this.perform(request, signal); this.publish(); return { ok: true, selectedPath, state: { ...this.view(), busy: false } }; }
    catch (e) { const message = signal.aborted ? '操作已停止' : e instanceof Error ? e.message : '软件配置操作失败'; this.notice = message; return { ok: false, message, state: { ...this.view(), busy: false } }; }
    finally { this.busy = false; this.publish(); }
  }
  private async perform(request: Exclude<SoftwareRequest, { type: 'state' | 'stop' | 'configure-plugin' }>, signal: AbortSignal): Promise<string | undefined> {
    if (request.type === 'choose-directory' || request.type === 'choose-runtime') return this.host.choose(request.type === 'choose-directory' ? 'directory' : 'runtime', request.current);
    if (request.type === 'import-plugin') {
      const source = await this.host.choose('plugin', ''); signal.throwIfAborted();
      if (source) { const plugin = await this.plugins.install(source); this.notice = `已导入 ${plugin.manifest.name}。绑定软件并连接后可查看能力`; }
      return;
    }
    if (request.type === 'install-bundled') {
      const bundled = this.host.bundled?.find(p => p.id === request.id);
      if (!bundled) throw new Error('随附插件不存在');
      await this.plugins.install(bundled.directory); this.notice = `已安装 ${bundled.name}，请添加软件并连接授权`; return;
    }
    this.host.cancelChat();
    if (request.type === 'remove-plugin') {
      for (const entry of this.entries.filter(e => e.pluginId === request.id)) { await this.disconnect(entry.id); entry.enabled = false; entry.grants = []; entry.tools = []; }
      await this.persist(); signal.throwIfAborted(); await this.plugins.remove(request.id); this.notice = '插件已移除，关联软件已停用'; return;
    }
    if (request.type === 'save') {
      const draft = request.software, previous = draft.id ? this.entry(draft.id) : undefined;
      if (!previous && this.entries.length >= 30) throw new Error('最多添加 30 个软件');
      const plugin = await this.plugins.verify(draft.pluginId), directory = await softwareDirectory(draft.directory);
      const transport = plugin.manifest.transport;
      const runtimePath = transport.type === 'stdio' && transport.runtime !== 'executable' && !(transport.runtime === 'node' && !draft.runtimePath) ? await runtimeExecutable(draft.runtimePath) : '';
      const url = transport.type === 'streamable-http' ? endpoint(draft.url).toString() : '';
      const identityChanged = !previous || previous.directory !== directory || previous.pluginId !== draft.pluginId || previous.fingerprint !== plugin.fingerprint || previous.url !== url || previous.runtimePath !== runtimePath;
      let sealedToken = identityChanged ? '' : previous!.sealedToken;
      if (transport.type === 'streamable-http' && request.token !== undefined) sealedToken = request.token.trim() ? await this.host.seal(request.token.trim()) : '';
      const changed = identityChanged || (request.token !== undefined);
      const next: SoftwareEntry = { ...draft, id: previous?.id ?? randomUUID(), directory, runtimePath, url, fingerprint: plugin.fingerprint, enabled: false,
        tools: changed ? [] : previous!.tools, grants: changed ? [] : previous!.grants, sealedToken,
        remindersEnabled: changed ? false : previous!.remindersEnabled, lastReminderKey: changed ? '' : previous!.lastReminderKey };
      signal.throwIfAborted(); if (previous) await this.disconnect(previous.id);
      const oldEntries = this.entries; this.entries = [...this.entries.filter(e => e.id !== next.id), next];
      try { await this.persist(); } catch (e) { this.entries = oldEntries; throw e; }
      this.notice = '软件已保存。点击“连接并读取能力”，再勾选允许大肥鱼使用的工具'; return;
    }
    const entry = this.entry(request.id);
    if (request.type === 'connect') {
      await this.disconnect(entry.id); signal.throwIfAborted(); entry.enabled = true;
      try { await this.ensureConnected(entry, signal); signal.throwIfAborted(); await this.persist(); this.notice = entry.tools.length ? '已读取插件能力。勾选工具并保存授权后，大肥鱼才能使用' : '连接成功，插件尚未提供可调用能力'; }
      catch (e) { entry.enabled = false; await this.persist(); throw e; }
    } else if (request.type === 'reminders') {
      const tool = this.plugins.records.get(entry.pluginId)?.manifest.reminderTool;
      if (!tool || (request.enabled && (!entry.enabled || !entry.grants.some(g => g.name === tool)))) throw new Error('请先连接并授权插件的提醒工具');
      const previous = entry.remindersEnabled; entry.remindersEnabled = request.enabled;
      try { await this.persist(); } catch (e) { entry.remindersEnabled = previous; throw e; }
      this.notice = request.enabled ? '已启用计划提醒；大肥鱼运行时会按插件计划提醒' : '已关闭计划提醒';
    } else if (request.type === 'grant') {
      if (!entry.enabled || !this.sessions.has(entry.id) || this.statuses.get(entry.id)?.status !== 'connected') throw new Error('请先连接插件并读取最新能力');
      if (request.tools.some(name => !entry.tools.some(t => t.name === name))) throw new Error('不能授权插件未提供的能力');
      const previous = entry.grants;
      entry.grants = entry.tools.filter(t => request.tools.includes(t.name)).map(t => ({ name: t.name, signature: t.signature }));
      try { await this.persist(); } catch (e) { entry.grants = previous; throw e; }
      this.notice = `已保存 ${entry.grants.length} 项授权，可在桌面聊天中提出任务`;
    } else {
      await this.disconnect(entry.id); entry.enabled = false;
      if (request.type === 'remove') this.entries = this.entries.filter(e => e.id !== entry.id);
      await this.persist(); this.notice = request.type === 'remove' ? '软件关联已移除，实际软件文件未更改' : '软件已停用';
    }
  }
  private async ensureConnected(entry: SoftwareEntry, signal: AbortSignal): Promise<SoftwareConnection> {
    signal.throwIfAborted();
    const existing = this.sessions.get(entry.id); if (existing && this.statuses.get(entry.id)?.status === 'connected') return existing;
    const pending = this.connections.get(entry.id); if (pending) return pending;
    const promise = this.connect(entry, signal); this.connections.set(entry.id, promise);
    try { return await promise; } finally { if (this.connections.get(entry.id) === promise) this.connections.delete(entry.id); }
  }
  private async connect(entry: SoftwareEntry, signal: AbortSignal) {
    this.statuses.set(entry.id, { status: 'connecting' }); this.publish();
    let session: SoftwareConnection | undefined;
    try {
      const plugin = await this.plugins.verify(entry.pluginId);
      if (entry.fingerprint !== plugin.fingerprint) throw new Error('插件版本变化，请重新保存软件关联');
      if (await softwareDirectory(entry.directory) !== entry.directory) throw new Error('软件目录目标已变化，请重新选择');
      signal.throwIfAborted(); if (!entry.enabled) throw new Error('软件已停用');
      // 可变缓存放在实例数据目录，插件代码目录只用于完整性校验和读取资源。
      const dataDirectory = path.join(path.dirname(this.file), 'software-data', entry.id);
      await fs.mkdir(dataDirectory, { recursive: true }); signal.throwIfAborted();
      session = new SoftwareConnection(entry, plugin, dataDirectory, message => {
        if (this.sessions.get(entry.id) !== session) return;
        entry.grants = []; entry.enabled = false;
        this.statuses.set(entry.id, { status: 'error', error: message });
        this.sessions.delete(entry.id); void session!.close();
        void this.persist().catch(() => { this.notice = '撤销状态未能保存'; }).finally(() => this.publish());
      });
      this.sessions.set(entry.id, session);
      const tools = await session.connect(entry.sealedToken ? await this.host.unseal(entry.sealedToken) : '', signal);
      signal.throwIfAborted();
      if (!entry.enabled || this.sessions.get(entry.id) !== session) throw new Error('软件连接已取消');
      entry.grants = entry.grants.filter(g => tools.some(t => t.name === g.name && t.signature === g.signature)); entry.tools = tools;
      await this.persist(); this.statuses.set(entry.id, { status: 'connected' }); this.publish(); return session;
    } catch (e) {
      if (session) await session.close();
      if (this.sessions.get(entry.id) === session) this.sessions.delete(entry.id);
      this.statuses.set(entry.id, { status: 'error', error: signal.aborted ? '连接已停止' : e instanceof Error ? e.message : '插件连接失败' }); this.publish(); throw e;
    }
  }
  async list(parent: AbortSignal): Promise<ToolDefinition[]> {
    if (this.busy || this.closed) return [];
    const signal = AbortSignal.any([parent, this.lifecycle.signal]); const definitions: ToolDefinition[] = [];
    for (const entry of this.entries.filter(e => e.enabled && e.grants.length)) {
      signal.throwIfAborted();
      try {
        await this.ensureConnected(entry, signal);
        for (const tool of entry.tools.filter(t => t.name !== this.plugins.records.get(entry.pluginId)?.manifest.learningRecordTool && entry.grants.some(g => g.name === t.name && g.signature === t.signature))) definitions.push({
          name: softwareToolName(entry.id, tool.name), description: `软件：${entry.name}；插件：${this.plugins.records.get(entry.pluginId)!.manifest.name}；能力：${tool.name}。${tool.description}`.slice(0, 1600), inputSchema: tool.inputSchema
        });
      } catch { signal.throwIfAborted(); /* 一个插件失败不阻断聊天和其他软件；错误在软件页中显示。 */ }
    }
    // 供应商通常限制工具数；超额时明确报告，避免静默漏掉软件。
    if (definitions.length > 100) throw new Error('启用的插件能力超过 100 项，请在可操作软件中减少授权');
    return definitions;
  }
  // 宿主只认识通用学习记录协议，不依赖具体软件。授权仍绑定插件工具的签名。
  learningTargets() {
    return this.entries.filter(entry => {
      const name = this.plugins.records.get(entry.pluginId)?.manifest.learningRecordTool;
      return entry.enabled && entry.tools.some(t => t.name === name && entry.grants.some(g => g.name === t.name && g.signature === t.signature));
    }).map(e => ({ id: e.id, name: e.name }));
  }
  async recordLearning(id: string, payload: Record<string, unknown>, signal: AbortSignal) {
    const entry = this.entry(id); const name = this.plugins.records.get(entry.pluginId)?.manifest.learningRecordTool;
    if (!name || !this.learningTargets().some(t => t.id === id)) throw new Error('学习记录插件未启用或未授权');
    return learningRecordResult(await this.call(softwareToolName(id, name), payload, signal));
  }
  async call(name: string, args: Record<string, unknown>, parent: AbortSignal, silent = false): Promise<string> {
    if (this.busy || this.closed || this.invoking) throw new Error('软件管理或其他工具正在处理，请稍后重试');
    if (JSON.stringify(args).length > 128000) throw new Error('工具参数过大');
    const entry = this.entries.find(e => e.tools.some(t => softwareToolName(e.id, t.name) === name));
    const tool = entry?.tools.find(t => softwareToolName(entry.id, t.name) === name);
    const permitted = () => entry && tool && entry.enabled && this.entries.includes(entry) && entry.grants.some(g => g.name === tool.name && g.signature === tool.signature);
    if (!entry || !tool || !permitted()) throw new Error('此软件能力尚未授权或授权已撤销');
    this.invoking = true;
    const signal = AbortSignal.any([parent, this.lifecycle.signal]);
    const activity: SoftwareView['activities'][number] = { id: randomUUID(), at: Date.now(), software: entry.name, tool: tool.name, status: 'running' };
    if (!silent) { this.activities = [...this.activities, activity].slice(-50); this.publish(); }
    let operating = false;
    const finishOperation = () => { if (operating) { operating = false; this.host.operating?.(false); } };
    signal.addEventListener('abort', finishOperation, { once: true });
    try {
      await this.plugins.verify(entry.pluginId);
      if (await softwareDirectory(entry.directory) !== entry.directory) throw new Error('软件目录目标已变化');
      const session = await this.ensureConnected(entry, signal); signal.throwIfAborted();
      if (!permitted() || this.statuses.get(entry.id)?.status !== 'connected') throw new Error('软件授权已变化，请重新连接并授权');
      // 连接、授权和后台提醒轮询不是用户委托的软件操作，不能触发操作中的动作。
      if (!silent) { operating = true; this.host.operating?.(true); }
      let result: string;
      try { result = await session.call(tool.name, args, signal); }
      finally { finishOperation(); }
      signal.throwIfAborted(); activity.status = 'completed'; return result;
    } catch (e) {
      activity.status = signal.aborted ? 'cancelled' : 'failed'; activity.message = signal.aborted ? '调用已取消，已执行的外部操作不会撤销' : '插件调用失败，请检查连接、权限和目标软件';
      // 取消或超时后关闭会话，不自动重试可能已经执行的操作。
      await this.disconnect(entry.id); throw e;
    } finally { finishOperation(); signal.removeEventListener('abort', finishOperation); this.invoking = false; if (!silent) this.publish(); }
  }
  async pollReminders() {
    if (this.closed || this.busy || this.invoking || this.polling || !this.host.remind || !this.host.canRemind?.()) return;
    this.polling = true;
    try {
      for (const entry of this.entries.filter(e => e.enabled && e.remindersEnabled)) {
        const name = this.plugins.records.get(entry.pluginId)?.manifest.reminderTool;
        if (!name || !entry.grants.some(g => g.name === name)) continue;
        const stillAllowed = () => !this.closed && this.entries.includes(entry) && entry.enabled && entry.remindersEnabled && entry.grants.some(g => g.name === name);
        try {
          const result = pluginResult(await this.call(softwareToolName(entry.id, name), {}, this.lifecycle.signal, true)) as { key?: unknown; text?: unknown } | null;
          if (!result || typeof result.key !== 'string' || !result.key || result.key.length > 200 || typeof result.text !== 'string' || !result.text || result.text.length > 500) continue;
          if (result.key === entry.lastReminderKey || !stillAllowed() || !this.host.canRemind?.()) continue;
          const previous = entry.lastReminderKey; entry.lastReminderKey = result.key;
          try { await this.persist(); } catch (e) { entry.lastReminderKey = previous; throw e; }
          if (!stillAllowed()) continue;
          this.host.remind(result.text); this.publish();
        } catch { /* Anki 关闭等错误保留在连接状态；一分钟后重试，不弹连续错误通知。 */ }
      }
    } finally { this.polling = false; }
  }
  private async disconnect(id: string) { const session = this.sessions.get(id); this.sessions.delete(id); if (this.statuses.get(id)?.status !== 'error') this.statuses.set(id, { status: 'disconnected' }); if (session) await session.close(); }
  private async disconnectAll() { await Promise.all([...this.sessions.keys()].map(id => this.disconnect(id))); }
  async close() { this.closed = true; if (this.reminderTimer) clearInterval(this.reminderTimer); this.lifecycle.abort(); await this.disconnectAll(); await this.writing; }
}
