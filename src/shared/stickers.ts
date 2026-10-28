import { z } from 'zod';

const webUrl = z.string().max(2000).url().refine(raw => { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash; }, '表情来源必须是 HTTPS 网页');
export const stickerPluginSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/), name: z.string().min(1).max(80), version: z.string().min(1).max(40),
  description: z.string().max(1000), source: webUrl, upstreamVersion: z.string().max(40), upstreamCommit: z.string().regex(/^[a-f0-9]{40}$/),
  origin: webUrl.refine(raw => new URL(raw).origin === raw), author: z.string().max(100), authorUrl: webUrl, license: z.string().max(500)
}).strict();
export type StickerPlugin = z.infer<typeof stickerPluginSchema>;
export const stickerSchema = z.object({
  id: z.string().min(1).max(200), pack: z.string().min(1).max(80), name: z.string().min(1).max(160),
  hash: z.string().regex(/^[a-f0-9]{12}$/), bytes: z.number().int().min(14).max(8 * 1024 * 1024),
  width: z.number().int().min(1).max(1024), height: z.number().int().min(1).max(1024), frames: z.number().int().min(1).max(500), url: webUrl,
  emotion: z.string().max(80), tags: z.array(z.string().max(80)).max(40), description: z.string().max(2000), use: z.string().max(1000), direction: z.string().max(200), text: z.string().max(1000), meme: z.string().max(4000)
}).strict();
export type Sticker = z.infer<typeof stickerSchema>;
export const stickerCatalogSchema = z.object({ updated: z.string().max(80), items: z.array(stickerSchema).min(1).max(2000) }).strict();
export const stickerSettingsSchema = z.object({
  enabled: z.boolean().default(false), offline: z.boolean().default(false), frequency: z.enum(['rare', 'normal', 'often', 'always']).default('normal'),
  packs: z.array(z.string().max(80)).max(30).default([]), blocked: z.array(z.string().max(200)).max(2000).default([])
}).strict();
export type StickerSettings = z.infer<typeof stickerSettingsSchema>;
export interface StickerItem extends Omit<Sticker, 'url' | 'hash'> { image: string; cached: boolean; blocked: boolean }
export interface StickerView { plugin: StickerPlugin | null; settings: StickerSettings; total: number; cached: number; cacheBytes: number; packs: { name: string; count: number }[]; notice?: string }
export const stickerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('import-plugin') }).strict(),
  z.object({ type: z.literal('configure'), settings: stickerSettingsSchema }).strict(),
  z.object({ type: z.literal('search'), query: z.string().max(200), pack: z.string().max(80).default(''), offset: z.number().int().min(0).max(2000).default(0) }).strict(),
  z.object({ type: z.literal('preview'), id: z.string().max(200), bubble: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('clear-cache') }).strict()
]);
export type StickerRequest = z.input<typeof stickerRequestSchema>;
export interface StickerResponse { ok: boolean; state: StickerView; message?: string; items?: StickerItem[]; matches?: number; item?: StickerItem }
export interface StickerBridge { stickers(request: StickerRequest): Promise<StickerResponse>; onStickers(fn: (state: StickerView) => void): () => void }

// 仅接受宿主为目录资源生成的地址，Markdown 无权加载任意网络图片或本机路径。
export function stickerImageUrl(value: unknown): value is string { return typeof value === 'string' && /^petsticker:\/\/local\/[a-f0-9]{64}\.gif$/.test(value); }
export function stickerMarkdown(item: { name: string; image: string }) { return `![${item.name.replace(/[[\]\\\r\n]/g, '')}](${item.image})`; }
