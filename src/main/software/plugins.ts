import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { softwarePluginSchema, type InstalledSoftwarePlugin } from '../../shared/software';

export interface PluginRecord extends InstalledSoftwarePlugin { directory: string }
export function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export async function softwareDirectory(raw: string) {
  if (!path.isAbsolute(raw) || raw.startsWith('\\\\') || raw.startsWith('//') || [...raw].some(c => c.charCodeAt(0) < 32)) throw new Error('请选择本机的绝对目录');
  const directory = await fs.realpath(raw);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('软件位置必须是文件夹');
  return directory;
}
// 导入时只复制，不安装依赖、不执行代码。链接与联接不进入插件仓库。
export async function inspectPlugin(directory: string): Promise<PluginRecord> {
  const files: string[] = []; let bytes = 0, count = 0;
  async function walk(current: string, depth: number) {
    if (depth > 12) throw new Error('插件目录层级超过 12 层');
    for (const name of (await fs.readdir(current)).sort()) {
      if (++count > 3000) throw new Error('插件文件和目录超过 3000 项');
      const file = path.join(current, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('插件不允许包含符号链接或目录联接');
      if (stat.isDirectory()) await walk(file, depth + 1);
      else if (stat.isFile()) { bytes += stat.size; if (bytes > 200 * 1024 * 1024) throw new Error('插件大小超过 200 MiB'); files.push(file); }
      else throw new Error('插件中包含不支持的文件类型');
    }
  }
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('插件根目录不能是链接');
  await walk(directory, 0);
  const manifestFile = path.join(directory, 'software-plugin.json');
  if ((await fs.stat(manifestFile)).size > 32768) throw new Error('插件清单过大');
  const manifest = softwarePluginSchema.parse(JSON.parse(await fs.readFile(manifestFile, 'utf8')));
  if (manifest.transport.type === 'stdio') {
    const entry = path.resolve(directory, manifest.transport.entry);
    if (!within(directory, entry) || !(await fs.stat(entry)).isFile()) throw new Error('插件入口不存在或越界');
    const extensions = { executable: ['.exe'], node: ['.js', '.cjs', '.mjs'], python: ['.py'] };
    if (!extensions[manifest.transport.runtime].includes(path.extname(entry).toLowerCase())) throw new Error('插件入口扩展名与运行方式不匹配');
  }
  const hash = createHash('sha256');
  for (const file of files) { hash.update(path.relative(directory, file).replaceAll('\\', '/')); hash.update('\0'); hash.update(createHash('sha256').update(await fs.readFile(file)).digest()); }
  return { manifest, fingerprint: hash.digest('hex'), directory };
}
export class SoftwarePlugins {
  records = new Map<string, PluginRecord>(); warnings: string[] = [];
  constructor(readonly root: string) {}
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    for (const name of await fs.readdir(this.root)) {
      if (name.startsWith('.')) continue;
      try {
        const record = await inspectPlugin(path.join(this.root, name));
        if (record.manifest.id !== name) throw new Error('清单 ID 与安装目录不一致');
        this.records.set(name, record);
      } catch { this.warnings.push(`插件 ${name} 无法加载，请移除后重新导入`); }
    }
  }
  async install(source: string) {
    const resolved = await fs.realpath(source), root = await fs.realpath(this.root);
    if (resolved === root || within(resolved, root) || within(root, resolved)) throw new Error('请从插件仓库以外的下载目录导入');
    const inspected = await inspectPlugin(source);
    if (this.records.has(inspected.manifest.id)) throw new Error('此插件已经安装。更新时请先移除旧插件，再导入新版并重新授权。');
    const target = path.join(this.root, inspected.manifest.id), temporary = path.join(this.root, `.import-${randomUUID()}`);
    try {
      await fs.cp(source, temporary, { recursive: true, dereference: false, errorOnExist: true });
      const copied = await inspectPlugin(temporary);
      if (copied.fingerprint !== inspected.fingerprint) throw new Error('导入过程中插件发生变化，请重新导入');
      if (await fs.stat(target).then(() => true, () => false)) throw new Error('安装目录已存在，请先移除原插件目录');
      await fs.rename(temporary, target);
      const record = { ...copied, directory: target }; this.records.set(record.manifest.id, record); return record;
    } finally { await this.removeOwned(temporary); }
  }
  async verify(id: string) {
    const record = this.records.get(id); if (!record) throw new Error('插件尚未安装，请先导入相应插件');
    const actual = await inspectPlugin(record.directory);
    if (actual.fingerprint !== record.fingerprint) throw new Error('插件文件已变化，请移除并重新导入、授权');
    return record;
  }
  async remove(id: string) {
    const record = this.records.get(id); if (!record) throw new Error('插件不存在');
    await this.removeOwned(record.directory); this.records.delete(id);
  }
  private async removeOwned(target: string) {
    const root = path.resolve(this.root), absolute = path.resolve(target);
    if (!within(root, absolute) || path.dirname(absolute) !== root) throw new Error('拒绝移除插件仓库以外的路径');
    await fs.rm(absolute, { recursive: true, force: true });
  }
}
