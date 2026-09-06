import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { packSchema, motionSchema, groupSchema, guardTree, makeCatalog, relativePath, type LoadedPack, type Registry } from '../shared/schema';
export function resolveSafe(root: string, file: string) { relativePath.parse(file); const target = path.resolve(root, file); const relative = path.relative(path.resolve(root), target); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`路径逃逸：${file}`); return target; }
export function imageSize(data: Buffer): { width: number; height: number } {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && data[20] === 0x2f) { const bits = data.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  }
  throw new Error('图像头无效，只允许 PNG / WebP');
}
export async function inspectFolder(root: string): Promise<Map<string, { path: string; size: number }>> {
  const files = new Map<string, { path: string; size: number }>(); let total = 0; let entries = 0; let decodedBytes = 0;
  async function visit(dir: string, depth: number) {
    if (depth > 12) throw new Error('文件夹嵌套过深');
    const stat = await fs.lstat(dir); if (stat.isSymbolicLink()) throw new Error('不允许符号链接或目录联接');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++entries > 1000) throw new Error('每包最多 1000 个文件和目录'); const full = path.join(dir, entry.name); const s = await fs.lstat(full);
      if (s.isSymbolicLink()) throw new Error(`不允许链接：${entry.name}`);
      if (entry.isDirectory()) { await visit(full, depth + 1); continue; }
      const name = path.relative(root, full).split(path.sep).join('/'); resolveSafe(root, name);
      if (!s.isFile() || !/\.(json|png|webp)$/i.test(name)) throw new Error(`禁止的文件类型：${name}`);
      total += s.size; if (total > 100 * 1024 * 1024) throw new Error('动作包超过 100 MB');
      if (/\.json$/i.test(name) && s.size > 1024 * 1024) throw new Error(`JSON 超过 1 MB：${name}`);
      if (/\.(png|webp)$/i.test(name)) { const handle = await fs.open(full, 'r'); const header = Buffer.alloc(32); try { await handle.read(header, 0, 32, 0); } finally { await handle.close(); } const size = imageSize(header); if (size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) throw new Error(`图片必须在 4096×4096 内：${name}`); decodedBytes += size.width * size.height * 4; if(decodedBytes > 256 * 1024 * 1024) throw new Error('动作包图片解码预算超过 256 MB'); }
      files.set(name, { path: full, size: s.size });
    }
  }
  await visit(root, 0); return files;
}
export async function readPack(root: string, builtin: boolean, authorize: (file: string) => string): Promise<LoadedPack> {
  const files = await inspectFolder(root);
  async function json(file: string): Promise<unknown> { const resolved = resolveSafe(root, file); if (!files.has(file) || !file.endsWith('.json')) throw new Error(`清单中的 JSON 不存在：${file}`); try { return JSON.parse(await fs.readFile(resolved, 'utf8')); } catch (e) { throw new Error(`${file}：${String(e)}`); } }
  const manifest = packSchema.parse(await json('pack.json'));
  if (!builtin && manifest.id.startsWith('builtin.')) throw new Error('builtin.* 是保留命名空间');
  const motions = await Promise.all(manifest.motions.map(async f => motionSchema.parse(await json(f))));
  const groups = await Promise.all(manifest.groups.map(async f => { const raw = await json(f); if (typeof raw === 'object' && raw && 'timeline' in raw) guardTree(raw.timeline); return groupSchema.parse(raw); }));
  const assets: Record<string, string> = {};
  for (const [file, info] of files) if (/\.(png|webp)$/i.test(file)) assets[file] = authorize(info.path);
  for (const m of motions) if (m.kind === 'frame_animation') for (const frame of m.frames) { const item = files.get(frame); if (!item || !assets[frame]) throw new Error(`缺少帧：${frame}`); const handle = await fs.open(item.path, 'r'); const buffer = Buffer.alloc(32); try { await handle.read(buffer, 0, 32, 0); } finally { await handle.close(); } const size = imageSize(buffer); if (size.width !== m.canvas.width || size.height !== m.canvas.height) throw new Error(`序列帧画布尺寸不一致：${frame}`); }
  return { manifest, motions, groups, assets };
}
export class PackStore {
  registry: Registry = { revision: 0, packs: [] }; approved = new Map<string, string>(); errors: string[] = [];
  constructor(readonly builtinDir: string, readonly userDir: string) {}
  authorize = (file: string) => { const token = randomUUID(); this.approved.set(token, file); return `petasset://local/${token}`; };
  async candidate(): Promise<Registry> {
    await fs.mkdir(this.userDir, { recursive: true }); this.errors = [];
    const builtin = await readPack(this.builtinDir, true, this.authorize); const packs = [builtin];
    for (const entry of await fs.readdir(this.userDir, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try { const p = await readPack(path.join(this.userDir, entry.name), false, this.authorize); if (p.manifest.id !== entry.name) throw new Error('包文件夹名必须与 packId 一致'); makeCatalog({ revision: 0, packs: [...packs, p] }); packs.push(p); }
      catch (e) { this.errors.push(`${entry.name}: ${String(e)}`); const old = this.registry.packs.find(p => p.manifest.id === entry.name); if (old) packs.push(old); }
    }
    const next = { revision: this.registry.revision + 1, packs }; makeCatalog(next); return next;
  }
  commit(next: Registry) { this.registry = next; const used = new Set(next.packs.flatMap(p => Object.values(p.assets)).map(url => new URL(url).pathname.slice(1))); for (const token of this.approved.keys()) if (!used.has(token)) this.approved.delete(token); }
}
