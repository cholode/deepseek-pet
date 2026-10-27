import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Sticker } from '../../shared/stickers';
import { stickerKey } from './catalog';

const LIMIT = 8 * 1024 * 1024;
const CACHE_LIMIT = 128 * 1024 * 1024;
const cacheName = /^[a-f0-9]{64}\.gif$/;
export function validStickerImage(data: Buffer, item: Sticker) {
  return data.length === item.bytes && data.length <= LIMIT && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')) &&
    data.readUInt16LE(6) === item.width && data.readUInt16LE(8) === item.height && createHash('sha1').update(data).digest('hex').startsWith(item.hash);
}
export class StickerCache {
  private files = new Map<string, { size: number; used: number }>();
  private downloads = new Map<string, Promise<void>>();
  private generation = new AbortController();
  constructor(private directory: string, private fetcher: typeof fetch = fetch) {}
  async start() {
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.lstat(this.directory)).isSymbolicLink()) throw new Error('表情缓存目录不能是链接');
    for (const name of await fs.readdir(this.directory)) {
      if (!cacheName.test(name)) continue;
      const stat = await fs.lstat(path.join(this.directory, name));
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMIT) this.files.set(name.slice(0, -4), { size: stat.size, used: stat.mtimeMs });
    }
    await this.trim();
  }
  has(item: Sticker) { return this.files.has(stickerKey(item)); }
  get count() { return this.files.size; }
  get bytes() { return [...this.files.values()].reduce((sum, file) => sum + file.size, 0); }
  async read(item: Sticker): Promise<Buffer | undefined> {
    const key = stickerKey(item), file = path.join(this.directory, `${key}.gif`);
    if (!this.files.has(key)) return;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes) throw new Error('缓存图像无效');
      const data = await fs.readFile(file);
      if (!validStickerImage(data, item)) throw new Error('缓存图像校验失败');
      this.files.set(key, { size: data.length, used: Date.now() }); return data;
    } catch { this.files.delete(key); return; }
  }
  async ensure(item: Sticker, offline: boolean, parent: AbortSignal) {
    parent.throwIfAborted(); if (await this.read(item)) { parent.throwIfAborted(); return; }
    if (offline) throw new Error('这张表情尚未缓存；关闭“仅使用已下载表情”后可下载');
    const key = stickerKey(item);
    let pending = this.downloads.get(key);
    if (!pending) {
      const signal = AbortSignal.any([parent, this.generation.signal, AbortSignal.timeout(20000)]);
      pending = this.download(item, signal).finally(() => this.downloads.delete(key)); this.downloads.set(key, pending);
    }
    await pending; parent.throwIfAborted();
  }
  private async download(item: Sticker, signal: AbortSignal) {
    const response = await this.fetcher(item.url, { signal, redirect: 'error', credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error(`表情下载失败（HTTP ${response.status}），请稍后重试`);
    if (Number(response.headers.get('content-length')) > LIMIT) { await response.body.cancel(); throw new Error('表情文件超过大小限制'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > LIMIT || size > item.bytes) throw new Error('表情文件超过目录声明的大小');
        chunks.push(chunk.value);
      }
    } catch (e) { await reader.cancel().catch(() => {}); throw e; } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks);
    if (!validStickerImage(data, item)) throw new Error('表情图像与目录不匹配，请更新表情插件后重试');
    signal.throwIfAborted();
    const key = stickerKey(item), temporary = path.join(this.directory, `${key}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, data, { flag: 'wx' }); signal.throwIfAborted();
      await fs.rename(temporary, path.join(this.directory, `${key}.gif`));
      this.files.set(key, { size: data.length, used: Date.now() }); await this.trim(key);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  private async trim(keep?: string) {
    for (const [key] of [...this.files].sort((a, b) => a[1].used - b[1].used)) {
      if (this.bytes <= CACHE_LIMIT) break;
      if (key === keep) continue;
      await fs.rm(path.join(this.directory, `${key}.gif`), { force: true }); this.files.delete(key);
    }
  }
  cancel() { this.generation.abort(); this.generation = new AbortController(); }
  async clear() {
    this.cancel(); await Promise.allSettled(this.downloads.values());
    // 仅删除本缓存目录中由宿主生成的文件名，不递归删除目录。
    for (const file of await fs.readdir(this.directory)) if (cacheName.test(file)) await fs.rm(path.join(this.directory, file), { force: true });
    this.files.clear();
  }
  async close() { this.cancel(); await Promise.allSettled(this.downloads.values()); }
}
