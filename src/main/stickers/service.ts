import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { isSimpleGreeting } from '../../shared/greeting';
import type { ToolPort } from '../../companion/ports';
import { stickerSettingsSchema, stickerRequestSchema, stickerImageUrl, stickerMarkdown, type Sticker, type StickerPlugin, type StickerSettings, type StickerView, type StickerItem, type StickerResponse } from '../../shared/stickers';
import { imageUrl, searchStickers } from './catalog';
import { StickerCache } from './cache';
import { readStickerPlugin, installStickerPlugin } from './plugin';

interface Host { changed(view: StickerView): void; preview(text: string): void; choosePlugin?(): Promise<string | undefined> }
export class StickerService implements ToolPort {
  private plugin: StickerPlugin | null = null;
  private items: Sticker[] = [];
  private settings: StickerSettings = stickerSettingsSchema.parse({});
  private notice?: string; private selected?: Sticker; private recent: string[] = [];
  private storage = Promise.resolve(); private changing = false; private epoch = 0;
  readonly cache: StickerCache;
  constructor(private directory: string, private pluginDirectory: string, private host: Host, fetcher: typeof fetch = fetch) {
    this.cache = new StickerCache(path.join(directory, 'cache'), fetcher);
  }
  async start() {
    try {
      const installed = path.join(this.directory, 'plugin');
      const source = await fs.stat(installed).then(() => installed, () => this.pluginDirectory);
      const { manifest, catalog } = await readStickerPlugin(source); this.plugin = manifest; this.items = catalog.items;
      await this.cache.start();
      this.settings.packs = [...new Set(this.items.map(item => item.pack))];
      try { this.settings = stickerSettingsSchema.parse(JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8'))); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          await fs.rename(path.join(this.directory, 'settings.json'), path.join(this.directory, `settings.corrupt-${Date.now()}.json`));
          this.notice = '表情设置损坏，已保留备份并恢复默认关闭状态';
        }
      }
    } catch (e) { this.plugin = null; this.items = []; this.notice = `表情插件未加载：${e instanceof Error ? e.message : String(e)}`; }
  }
  view(): StickerView {
    return { plugin: this.plugin, settings: structuredClone(this.settings), total: this.items.length, cached: this.cache.count, cacheBytes: this.cache.bytes, notice: this.notice,
      packs: [...new Set(this.items.map(item => item.pack))].map(name => ({ name, count: this.items.filter(item => item.pack === name).length })) };
  }
  private publish() { this.host.changed(this.view()); }
  private item(item: Sticker): StickerItem { const { url: _url, hash: _hash, ...data } = item; return { ...data, image: imageUrl(item), cached: this.cache.has(item), blocked: this.settings.blocked.includes(item.id) }; }
  private allowed() { return this.items.filter(item => this.settings.packs.includes(item.pack) && !this.settings.blocked.includes(item.id) && (!this.settings.offline || this.cache.has(item))); }
  private save() {
    const data = JSON.stringify(this.settings, null, 2);
    this.storage = this.storage.catch(() => {}).then(async () => {
      const file = path.join(this.directory, 'settings.json'); await fs.writeFile(`${file}.tmp`, data); await fs.rename(`${file}.tmp`, file);
    }); return this.storage;
  }
  async request(raw: unknown): Promise<StickerResponse> {
    try {
      const request = stickerRequestSchema.parse(raw);
      if (request.type === 'state') return { ok: true, state: this.view() };
      if (request.type === 'import-plugin') {
        if (this.changing) throw new Error('正在更新表情插件，请稍后重试');
        this.changing = true;
        try {
          const source = await this.host.choosePlugin?.(); if (!source) return { ok: false, message: '已取消导入', state: this.view() };
          this.epoch++; this.selected = undefined; this.cache.cancel();
          await readStickerPlugin(source);
          await fs.mkdir(this.directory, { recursive: true });
          this.settings = { ...this.settings, enabled: false }; await this.save();
          const { manifest, catalog } = await installStickerPlugin(source, this.directory);
          this.plugin = manifest; this.items = catalog.items; this.notice = undefined;
          this.settings = { ...this.settings, enabled: false, packs: [...new Set(this.items.map(item => item.pack))], blocked: this.settings.blocked.filter(id => this.items.some(item => item.id === id)) };
          await this.cache.start(); await this.save(); this.publish();
          return { ok: true, message: '表情插件已更新，请查看来源后开启自动选用', state: this.view() };
        } finally { this.changing = false; }
      }
      if (!this.plugin) throw new Error(this.notice ?? '表情插件不可用');
      if (request.type === 'search') {
        const found = searchStickers(this.items.filter(item => !request.pack || request.pack === item.pack), request.query);
        return { ok: true, state: this.view(), items: found.slice(request.offset, request.offset + 24).map(item => this.item(item)), matches: found.length };
      }
      if (this.changing) throw new Error('正在更新表情设置，请稍后重试');
      if (request.type === 'preview') {
        const item = this.items.find(item => item.id === request.id); if (!item) throw new Error('这张表情不在已安装的目录中');
        const epoch = this.epoch;
        await this.cache.ensure(item, this.settings.offline, AbortSignal.timeout(22000));
        if (epoch !== this.epoch) throw new Error('表情操作已取消');
        if (request.bubble) this.host.preview(stickerMarkdown({ name: item.name, image: imageUrl(item) }));
        this.publish(); return { ok: true, state: this.view(), item: this.item(item) };
      }
      this.changing = true;
      try {
        this.epoch++; this.selected = undefined; this.cache.cancel();
        if (request.type === 'configure') {
          if (request.settings.packs.some(pack => !this.items.some(item => item.pack === pack)) || request.settings.blocked.some(id => !this.items.some(item => item.id === id))) throw new Error('设置包含未知的表情或套组');
          const previous = this.settings; this.settings = request.settings;
          try { await this.save(); } catch (e) { this.settings = { ...previous, enabled: false }; throw e; }
        } else await this.cache.clear();
        this.publish(); return { ok: true, state: this.view() };
      } finally { this.changing = false; }
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : '表情操作失败', state: this.view() }; }
  }
  private quickGreeting = false;
  beginTurn(event: { text: string }) { this.selected = undefined; this.quickGreeting = isSimpleGreeting(event.text); }
  async list(signal: AbortSignal) {
    signal.throwIfAborted(); this.selected = undefined;
    if (!this.plugin || !this.settings.enabled || !this.allowed().length) return [];
    const frequency = { rare: '只在用户索要表情或情绪特别合适时使用', normal: '聊天中偶尔使用，不要每句话都发', often: '轻松聊天时可适当多用，认真解答时克制', always: '用户要求每次聊天回复都附一张表情，请根据语境挑选合适的一张，避免连续重复；严肃话题选择温和陪伴的表情' }[this.settings.frequency];
    return [
      { name: 'dafeiyu_sticker_search', description: `从你的表情包按情绪、场景查找 GIF。${frequency}。每轮最多选一张；双人表情注意互动方向。找到合适的 ID 后调用 dafeiyu_sticker_send，搜索本身不会显示图片。`, inputSchema: { type: 'object', properties: { query: { type: 'string', description: '中文情绪或场景，如 开心、鼓励学习、摸鱼、被夸' }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false } },
      { name: 'dafeiyu_sticker_send', description: '选择并展示一张已搜索到的表情。只接受真实目录 ID，成功后系统自动把 GIF 附在本轮回复末尾，无需复述地址。失败时不能说已发送；文字继续正常回答。', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '搜索结果中的完整 ID' } }, required: ['id'], additionalProperties: false } }
    ];
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.plugin || !this.settings.enabled || this.changing) throw new Error('表情功能已关闭');
    if (name === 'dafeiyu_sticker_search') {
      const input = z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(8).default(5) }).strict().parse(args);
      const hits = searchStickers(this.allowed(), input.query);
      const fresh = hits.filter(item => !this.recent.includes(item.id));
      return JSON.stringify((fresh.length ? fresh : hits).slice(0, input.limit).map(item => ({ id: item.id, name: item.name, emotion: item.emotion, tags: item.tags, use: item.use, direction: item.direction })));
    }
    if (name !== 'dafeiyu_sticker_send') throw new Error('未知表情工具');
    const { id } = z.object({ id: z.string().min(1).max(200) }).strict().parse(args);
    const item = this.allowed().find(item => item.id === id); if (!item) throw new Error('表情不存在、已禁用或离线未缓存，请重新搜索');
    if (this.selected) return JSON.stringify({ selected: this.selected.id, message: '本轮已有一张表情，将随最终回复显示' });
    const epoch = this.epoch;
    await this.cache.ensure(item, this.settings.offline, signal); signal.throwIfAborted();
    if (epoch !== this.epoch || !this.settings.enabled || !this.allowed().some(s => s.id === id)) throw new Error('表情授权或设置已变化，已取消发送');
    this.selected = item; this.notice = undefined; this.recent = [...this.recent, item.id].slice(-5); this.publish();
    return JSON.stringify({ selected: item.id, name: item.name, message: '表情已准备好，系统将自动附在你的最终回复后。请继续自然地回复用户。' });
  }
  async decorateReply(text: string, signal: AbortSignal = AbortSignal.timeout(5000)) {
    // “每次回复”由宿主兜底，不依赖模型一定记得调用工具；禁用、离线与单张限制仍生效。
    if (!this.selected && this.settings.enabled && this.settings.frequency === 'always' && !this.changing && this.plugin) {
      const epoch = this.epoch;
      const allowed = this.allowed(); const ranked = searchStickers(allowed, text.slice(0, 500));
      const candidates = ranked.length ? ranked : searchStickers(allowed, '陪伴 点头');
      const pool = candidates.length ? candidates : allowed;
      const fresh = pool.filter(item => !this.recent.includes(item.id));
      const choices = fresh.length ? fresh : pool;
      // 简短问候不为挑一张新 GIF 等待网络；优先已缓存的合适表情，再选其他可用缓存。
      const matchingCache = choices.filter(item => this.cache.has(item));
      const cached = this.quickGreeting && !matchingCache.length ? allowed.filter(item => this.cache.has(item)).sort((a, b) => Number(this.recent.includes(a.id)) - Number(this.recent.includes(b.id))) : matchingCache;
      const attempt = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      for (const item of [...cached, ...choices.filter(item => !this.cache.has(item))].slice(0, 2)) {
        try { await this.call('dafeiyu_sticker_send', { id: item.id }, attempt); break; }
        catch { signal.throwIfAborted(); if (attempt.aborted || epoch !== this.epoch || !this.settings.enabled || this.changing) break; }
      }
      if (!this.selected && this.settings.enabled) { this.notice = '本轮没有可用表情，请检查下载连接、可选套组或离线缓存；文字回复已保留'; this.publish(); }
    }
    signal.throwIfAborted();
    if (!this.selected || !this.settings.enabled) return text;
    const markdown = stickerMarkdown({ name: this.selected.name, image: imageUrl(this.selected) });
    // 只附实际成功选择的一张；取消的轮次不会进入保存和最终展示。
    return `${text.replace(/!\[[^\]]*\]\(petsticker:\/\/[^)]+\)/g, '').trim().slice(0, 7998 - markdown.length)}\n\n${markdown}`;
  }
  async image(raw: string) {
    if (!stickerImageUrl(raw)) return;
    const item = this.items.find(item => imageUrl(item) === raw); return item ? this.cache.read(item) : undefined;
  }
  async close() { this.epoch++; this.selected = undefined; await this.cache.close(); await this.storage.catch(() => {}); }
}
