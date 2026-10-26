import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { diaryDateSchema } from '../../shared/diary';

const prefix = '大肥鱼日记-';
const limit = 1024 * 1024;
const fileName = (date: string) => `${prefix}${diaryDateSchema.parse(date)}.md`;

export function absoluteDirectory(value: string) {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('请填写完整的本地文件夹路径');
  return path.resolve(value);
}
export async function writableDirectory(value: string) {
  const directory = absoluteDirectory(value);
  await fs.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.fish-diary-${randomUUID()}.tmp`);
  await fs.writeFile(probe, '', { flag: 'wx' }); await fs.unlink(probe);
  return directory;
}
// 不从便携版的临时解压目录写日记；优先识别实际源码根目录。
export async function defaultDiaryDirectory(candidates: string[], fallback: string) {
  for (const candidate of candidates.filter(Boolean)) {
    let directory = path.resolve(candidate);
    for (let i = 0; i < 8; i++) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
        if (meta.name === 'deepblue-desktop-pet' && (await fs.stat(path.join(directory, 'src'))).isDirectory()) return directory;
      } catch { /* 不是源码根目录，继续向上查找。 */ }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
  }
  return absoluteDirectory(fallback);
}
export async function listDiaries(directory: string) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter(e => e.isFile() &&
      e.name.startsWith(prefix) && e.name.endsWith('.md') && diaryDateSchema.safeParse(e.name.slice(prefix.length, -3)).success)
      .map(e => ({ date: e.name.slice(prefix.length, -3), name: e.name })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
export async function readDiary(directory: string, date: string) {
  const file = path.join(directory, fileName(date));
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('日记必须是普通 Markdown 文件');
  if (stat.size > limit) throw new Error('这篇日记超过 1MB，请在文件夹中查看或整理');
  return fs.readFile(file, 'utf8');
}
export const automaticDiaryMarker = (date: string) => `<!-- dafeiyu-auto-diary:${diaryDateSchema.parse(date)} -->`;
export async function readAutomaticDiary(directory: string, date: string) {
  try { const content = await readDiary(directory, date); return content.includes(automaticDiaryMarker(date)) ? content : undefined; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export async function appendDiary(directory: string, date: string, entry: string, signal: AbortSignal, automatic = false) {
  await writableDirectory(directory);
  let previous = '';
  try { previous = await readDiary(directory, date); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (automatic && previous.includes(automaticDiaryMarker(date))) return previous;
  if (automatic) entry = `${automaticDiaryMarker(date)}\n\n${entry}`;
  const content = previous ? `${previous.trimEnd()}\n\n---\n\n${entry}\n` : `# ${date} · 大肥鱼的日记\n\n${entry}\n`;
  if (Buffer.byteLength(content, 'utf8') > limit) throw new Error('当天日记已达到 1MB，请先整理文件');
  const file = path.join(directory, fileName(date)), temp = path.join(directory, `.fish-diary-${randomUUID()}.tmp`);
  // 同一服务串行提交。临时文件写完才替换，失败或取消不会留下半篇正文。
  try {
    signal.throwIfAborted(); await fs.writeFile(temp, content, { flag: 'wx' }); signal.throwIfAborted();
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
  return content;
}
