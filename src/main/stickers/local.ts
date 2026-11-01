import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { localStickerPack, localStickerSchema, stickerDetailsSchema, type LocalSticker } from '../../shared/stickers';

const catalogSchema = z.object({ schemaVersion: z.literal(1), items: z.array(localStickerSchema).max(1000) }).strict();
const byteLimit = 20 * 1024 * 1024, libraryLimit = 512 * 1024 * 1024;

/** 本地原图独立持久保存，不参与下载缓存淘汰；文件名来自内容哈希，不接受 renderer 传入路径。 */
export class LocalStickerLibrary {
  private entries: LocalSticker[] = [];
  private ready = false;
  notice?: string;
  constructor(private directory: string) {}
  get items(): readonly LocalSticker[] { return this.entries; }
  private file(item: LocalSticker) { return path.join(this.directory, `${item.sha256}.${item.format}`); }
  async start() {
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.lstat(this.directory)).isSymbolicLink()) throw new Error('本地表情目录不能是链接');
    this.ready = true;
    const file = path.join(this.directory, 'catalog.json');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('本地表情目录无效');
      const parsed = catalogSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
      if (new Set(parsed.items.map(item => item.id)).size !== parsed.items.length || parsed.items.some(item => item.id !== `custom:${item.sha256}`)) throw new Error('本地表情索引无效');
      this.entries = parsed.items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      // 索引坏掉也保留原图和索引备份，不能把用户唯一的本地图片当缓存删除。
      await fs.rename(file, path.join(this.directory, `catalog.corrupt-${Date.now()}.json`));
      this.notice = '本地表情索引损坏，已备份并保留原图，可重新导入';
    }
  }
  private async save(items: LocalSticker[]) {
    const temporary = path.join(this.directory, `catalog-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, items }, null, 2), { flag: 'wx' });
      await fs.rename(temporary, path.join(this.directory, 'catalog.json')); this.entries = items;
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async importFiles(files: readonly string[]) {
    if (!this.ready) throw new Error('本地表情目录不可用，请检查小屋提示');
    if (files.length > 50) throw new Error('一次最多导入 50 张图片，请分批选择');
    const added: LocalSticker[] = [], existing: LocalSticker[] = [], errors: string[] = [];
    // 批量导入逐张提交：一张坏图不撤销其他已成功导入的图片，也不吞掉失败原因。
    for (const file of files) {
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 14 || stat.size > byteLimit) throw new Error('请选择 20 MB 以内的图片文件');
        const data = await fs.readFile(file);
        if (data.length > byteLimit) throw new Error('图片超过 20 MB');
        const supported = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')) ||
          (data[0] === 255 && data[1] === 216 && data[2] === 255) ||
          (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP');
        if (!supported) throw new Error('支持 PNG、JPG、WebP 和 GIF 图片');
        const sha256 = createHash('sha256').update(data).digest('hex');
        const duplicate = this.entries.find(item => item.sha256 === sha256);
        if (duplicate && await this.read(duplicate)) { existing.push(duplicate); continue; }
        // 按真实内容识别格式；仅在用户导入时加载解码库，不给聊天或启动增加图像处理开销。
        const sharp = (await import('sharp')).default;
        const image = sharp(data, { limitInputPixels: 4096 * 4096, failOn: 'error' });
        const metadata = await image.metadata();
        const format = z.enum(['png', 'jpeg', 'gif', 'webp']).safeParse(metadata.format);
        if (!format.success) throw new Error('支持 PNG、JPG、WebP 和 GIF 图片');
        const width = metadata.width ?? 0, height = metadata.pageHeight ?? metadata.height ?? 0, frames = metadata.pages ?? 1;
        if (!width || !height || width > 4096 || height > 4096 || frames > 500) throw new Error('图片边长不能超过 4096 像素，动画最多 500 帧');
        // 实际解码首帧可发现多数截断/伪装图片；保存原字节，GIF/WebP 的所有动画帧不被重编码。
        await image.clone().resize(32, 32, { fit: 'inside' }).png().toBuffer();
        const item = duplicate ?? localStickerSchema.parse({ id: `custom:${sha256}`, pack: localStickerPack, sha256, format: format.data,
          name: path.basename(file, path.extname(file)).trim().slice(0, 160) || '我的表情', bytes: data.length, width, height, frames,
          emotion: '', tags: [], description: '', use: '', direction: '', text: '', meme: '' });
        if (!duplicate && (this.entries.length >= 1000 || this.entries.reduce((sum, row) => sum + row.bytes, 0) + data.length > libraryLimit)) throw new Error('我的表情已达到 1000 张或 512 MB，请先移除不需要的图片');
        const temporary = path.join(this.directory, `${sha256}-${randomUUID()}.tmp`);
        try { await fs.writeFile(temporary, data, { flag: 'wx' }); await fs.rename(temporary, this.file(item)); }
        finally { await fs.rm(temporary, { force: true }); }
        await this.save(duplicate ? [...this.entries] : [...this.entries, item]); added.push(item);
      } catch (error) { errors.push(`${path.basename(file)}：${error instanceof Error ? error.message : '导入失败'}`); }
    }
    return { added, existing, errors };
  }
  async read(item: LocalSticker): Promise<Buffer | undefined> {
    try {
      const file = this.file(item), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || stat.size > byteLimit) return;
      const data = await fs.readFile(file);
      return createHash('sha256').update(data).digest('hex') === item.sha256 ? data : undefined;
    } catch { return; }
  }
  async edit(id: string, input: unknown) {
    const item = this.entries.find(row => row.id === id); if (!item) throw new Error('这张本地表情不存在');
    const updated = { ...item, ...stickerDetailsSchema.parse(input) };
    await this.save(this.entries.map(row => row.id === id ? updated : row)); return updated;
  }
  async remove(id: string) {
    const item = this.entries.find(row => row.id === id); if (!item) throw new Error('这张本地表情不存在');
    await this.save(this.entries.filter(row => row.id !== id));
    await fs.rm(this.file(item), { force: true });
  }
}
