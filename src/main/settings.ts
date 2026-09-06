import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults, settingsSchema, type Settings } from '../shared/schema';
export class SettingsStore {
  value: Settings = structuredClone(defaults); error?: string; private writing = Promise.resolve();
  constructor(readonly file: string) {}
  async load() { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { this.value = settingsSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8'))); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { const backup = `${this.file}.corrupt-${Date.now()}`; await fs.rename(this.file, backup).catch(() => {}); this.error = '配置损坏，已备份并恢复默认值'; } this.value = structuredClone(defaults); } return this.value; }
  save(value: Settings) { const next = settingsSchema.parse(value); this.value = next; const data = JSON.stringify(next, null, 2); const write = this.writing.then(async () => { const temp = `${this.file}.tmp`; await fs.writeFile(temp, data, 'utf8'); await fs.rename(temp, this.file); }); this.writing = write.catch(() => {}); return write.then(() => next); }
  flush() { return this.writing; }
}
