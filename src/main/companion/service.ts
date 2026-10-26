import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { companionRequestSchema, type CompanionRequest, type CompanionResponse, type CompanionView } from '../../shared/companion';
import type { PetEvent } from '../../shared/contracts';
import type { CompanionHost } from '../../companion/ports';
import { CompanionCoordinator } from '../../companion/coordinator';
import { recallMemories, remember } from '../../companion/memory';
import { applyEmotion, initialMood } from '../../companion/mood';
import { CompanionStore } from './store';
import { SecretStore } from './secrets';
import { CompatibleModel } from './model';
import { McpTools } from './mcp';
import { OneBotChannel } from './qq';
import { endpoint } from './http';

export class CompanionService {
  readonly store: CompanionStore; readonly secrets: SecretStore; readonly coordinator: CompanionCoordinator;
  private mcp: McpTools; private qq: OneBotChannel; private timer?: ReturnType<typeof setInterval>;
  private polling = false; private closed = false; private external = new AbortController(); private toolList: CompanionView['tools'] = [];
  private handling = false; private lastQqErrorAt = 0;
  constructor(directory: string, private host: CompanionHost, private mode: (enabled: boolean) => void) {
    this.store = new CompanionStore(path.join(directory, 'companion.json'));
    this.secrets = new SecretStore(path.join(directory, 'companion-secrets.json'));
    this.mcp = new McpTools(() => this.store.data.config.mcp, () => this.secrets.get('mcp'));
    this.qq = new OneBotChannel(() => this.store.data.config.qq, () => this.secrets.get('qq'));
    this.coordinator = new CompanionCoordinator(this.store, new CompatibleModel(() => this.secrets.get('model')), this.mcp, { ...host, changed: () => this.publish() });
  }
  async start() {
    await this.store.load();
    try { await this.secrets.load(); } catch (e) { this.coordinator.error = String(e); }
    this.coordinator.notice = this.store.warning;
    this.mode(this.coordinator.ready);
    this.timer = setInterval(() => { void this.tick().catch(e => { this.coordinator.error = e instanceof Error ? e.message : '后台任务失败'; this.publish(); }); }, 10000);
  }
  view(): CompanionView { return { ...this.coordinator.view(), hasSecrets: this.secrets.status(), tools: this.toolList }; }
  private publish() { if (!this.closed) this.host.changed(this.view()); }
  async request(raw: unknown): Promise<CompanionResponse> {
    const request = companionRequestSchema.parse(raw);
    if (request.type === 'state') return { ok: true, state: this.view() };
    if (request.type === 'cancel') { this.cancel(); return { ok: true, state: this.view() }; }
    if (this.handling) return { ok: false, message: '正在处理上一项操作，请稍候或停止', state: this.view() };
    this.handling = true;
    try { await this.execute(request); this.publish(); return { ok: true, state: this.view() }; }
    catch (e) { const message = e instanceof Error ? e.message : '操作失败'; this.coordinator.error = message; this.publish(); return { ok: false, message, state: this.view() }; }
    finally { this.handling = false; }
  }
  private async execute(request: CompanionRequest) {
    const data = this.store.data; const now = this.host.now();
    if (request.type === 'chat') { await this.coordinator.chat(request.text); return; }
    if (request.type === 'configure') {
      endpoint(request.config.model.baseUrl);
      endpoint(request.config.qq.baseUrl, true);
      if (request.config.mcp.enabled) endpoint(request.config.mcp.url);
      if (request.config.enabled && !request.config.model.model) throw new Error('请填写模型名称');
      if (request.config.qq.enabled && (!request.config.qq.ownerId || !request.config.qq.targetId)) throw new Error('请填写 QQ 绑定用户和目标号码');
      if (request.config.qq.enabled && request.config.qq.kind === 'private' && request.config.qq.ownerId !== request.config.qq.targetId) throw new Error('私聊目标必须与绑定用户为同一个 QQ 号');
      this.cancel(); await this.mcp.close();
      await this.secrets.set(request.secrets ?? {});
      const mcpChanged = data.config.mcp.url !== request.config.mcp.url;
      const qqChanged = JSON.stringify(data.config.qq) !== JSON.stringify(request.config.qq);
      data.config = request.config;
      // 授权绑定到具体服务地址，换服务器后必须重新发现并选择工具。
      if (mcpChanged) { data.config.mcp.allowedTools = []; this.toolList = []; }
      if (qqChanged) data.qqCursor = now;
      this.coordinator.error = undefined; this.mode(this.coordinator.ready);
    } else if (request.type === 'remember') {
      data.memories = remember(data.memories, { text: request.text, kind: request.kind, factKey: request.factKey, scope: request.scope, pinned: request.pinned, id: randomUUID(), importance: 1, createdAt: now, eventAt: now, sourceId: 'manual', evidence: request.text });
    } else if (request.type === 'forget') {
      this.cancel(); const memory = data.memories.find(m => m.id === request.id);
      if (!memory) throw new Error('记忆不存在');
      // 明确删除也清除当前对话上下文，避免模型从聊天原文立刻复述被忘记的内容。
      data.memories = data.memories.filter(m => m.scope !== memory.scope || (m.id !== memory.id && m.text !== memory.text && (!memory.factKey || m.factKey !== memory.factKey)));
      data.events = []; this.coordinator.recalls = [];
    } else if (request.type === 'recall') {
      this.coordinator.recalls = recallMemories(data.memories, request.query, 'private', data.config.memory, now);
    } else if (request.type === 'goal') {
      if (data.goals.length >= 200) throw new Error('约定数量达到上限');
      data.goals.push({ id: randomUUID(), text: request.text, dueAt: request.dueAt, completed: false });
    } else if (request.type === 'complete-goal') {
      const goal = data.goals.find(g => g.id === request.id); if (goal) goal.completed = true;
    } else if (request.type === 'discover-tools') {
      if (!data.config.mcp.enabled) throw new Error('请先保存并启用 MCP 服务');
      await this.mcp.close(); this.toolList = await this.mcp.list(AbortSignal.timeout(20000));
    } else if (request.type === 'clear-history') { this.cancel(); data.events = []; }
    else if (request.type === 'reset-mood') { this.cancel(); data.mood = initialMood(now, data.config.mood.baseline); }
    await this.store.save();
  }
  cancel() { this.coordinator.cancel(); this.external.abort(); this.external = new AbortController(); }
  // 交互事件只作本地轻量评价，不为摸头、拖动额外消耗模型请求。
  observe(events: PetEvent[]) {
    if (!this.coordinator.ready) return;
    let changed = false;
    for (const event of events) {
      if (event.type !== 'interaction' || event.payload.gesture !== 'click' || event.payload.target === 'desktop') continue;
      const id = `touch:${event.occurredAtUnixMs}:${event.payload.target}`;
      if (this.store.data.processedIds.includes(id)) continue;
      this.store.data.processedIds = [...this.store.data.processedIds, id].slice(-1000);
      this.store.data.mood = applyEmotion(this.store.data.mood, id, event.payload.target === 'head' ? 'happy' : 'curious', 2, event.payload.target === 'head' ? '刚被摸了摸头' : '收到了一次身体互动', 1, this.store.data.config.mood, this.host.now()); changed = true;
    }
    if (changed) void this.store.save().then(() => this.publish()).catch(() => { this.coordinator.error = '互动状态未能保存'; this.publish(); });
  }
  private async tick() {
    if (this.closed || this.polling || this.handling || this.coordinator.busy || !this.coordinator.ready || !this.host.available()) return;
    this.polling = true; const signal = this.external.signal;
    try {
      const data = this.store.data;
      if (data.config.qq.enabled && Date.now() - this.lastQqErrorAt > 30000) {
        try {
          if (!data.qqCursor) { data.qqCursor = this.host.now(); await this.store.save(); }
          const messages = await this.qq.poll(Math.max(data.qqCursor - 1000, this.host.now() - 600000), signal);
          for (const message of messages) {
            if (signal.aborted || this.closed) return;
            if (data.processedIds.includes(message.id)) continue;
            const reply = await this.coordinator.chat(message.text, message.source, message.id, message.conversationId);
            if (reply && !signal.aborted) await this.qq.send(reply, signal);
            data.qqCursor = Math.max(data.qqCursor, message.at); await this.store.save();
            break; // 一次只处理一条，让桌面用户有机会插话。
          }
        } catch (e) { if (!signal.aborted) { this.lastQqErrorAt = Date.now(); this.coordinator.error = `QQ 通道：${e instanceof Error ? e.message : '连接失败'}`; this.publish(); } }
      }
      if (!signal.aborted) await this.coordinator.tick();
    } finally { this.polling = false; }
  }
  async close() { this.closed = true; if (this.timer) clearInterval(this.timer); this.cancel(); await this.mcp.close(); await this.store.flush(); }
}
