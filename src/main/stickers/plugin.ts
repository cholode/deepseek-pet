import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { stickerCatalogSchema, stickerPluginSchema } from '../../shared/stickers';

async function readData(directory: string, name: string, limit: number) {
  const file = path.join(directory, name), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error(`插件文件无效或过大：${name}`);
  return fs.readFile(file, 'utf8');
}
export async function readStickerPlugin(directory: string) {
  const manifest = stickerPluginSchema.parse(JSON.parse(await readData(directory, 'sticker-plugin.json', 16000)));
  const catalog = stickerCatalogSchema.parse(JSON.parse(await readData(directory, 'catalog.json', 5 * 1024 * 1024)));
  if (new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error('表情目录包含重复 ID');
  if (catalog.items.some(item => new URL(item.url).origin !== manifest.origin)) throw new Error('表情地址超出插件声明的来源');
  return { manifest, catalog };
}
export async function installStickerPlugin(source: string, dataDirectory: string) {
  const parsed = await readStickerPlugin(source);
  // 导入仅复制数据与署名，不执行插件目录中的程序或脚本。
  const credits = await Promise.all(['NOTICE', 'LICENSE', 'LICENSE-ASSETS'].map(async name => [name, await readData(source, name, 64000)] as const));
  const root = path.resolve(dataDirectory), target = path.join(root, 'plugin'), stage = path.join(root, `.import-${randomUUID()}`), backup = path.join(root, `.backup-${randomUUID()}`);
  for (const candidate of [target, stage, backup]) if (path.dirname(candidate) !== root) throw new Error('插件安装路径无效');
  await fs.mkdir(stage, { recursive: true }); let moved = false;
  try {
    await fs.writeFile(path.join(stage, 'sticker-plugin.json'), JSON.stringify(parsed.manifest, null, 2));
    await fs.writeFile(path.join(stage, 'catalog.json'), JSON.stringify(parsed.catalog));
    for (const [name, value] of credits) await fs.writeFile(path.join(stage, name), value);
    await readStickerPlugin(stage);
    if (await fs.lstat(target).then(() => true, () => false)) { await fs.rename(target, backup); moved = true; }
    try { await fs.rename(stage, target); } catch (e) { if (moved) await fs.rename(backup, target); throw e; }
    if (moved) await fs.rm(backup, { recursive: true, force: true });
    return parsed;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
