import { promises as fs } from 'node:fs';
import path from 'node:path';
import { companionDataSchema, companionDefaults, type CompanionData } from '../../shared/companion';
import { initialMood } from '../../companion/mood';
import { growthDefaults } from '../../shared/growth';
import type { RepositoryPort } from '../../companion/ports';
const MAX_STORE_BYTES = 128 * 1024 * 1024;

// 存储可以替换为 SQLite；领域层只依赖 RepositoryPort，不知道文件路径。
export class CompanionStore implements RepositoryPort {
  data: CompanionData; warning?: string; private writing = Promise.resolve();
  constructor(readonly file: string, now = Date.now()) {
    this.data = { version: 1, config: structuredClone(companionDefaults), growth: structuredClone(growthDefaults), memories: [], goals: [], mood: initialMood(now), events: [], processedIds: [], initiative: { lastAt: 0, day: '', count: 0, lastTopic: '' }, qqCursor: 0 };
  }
  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const stat = await fs.stat(this.file); if (stat.size > MAX_STORE_BYTES) throw new Error('文件过大');
      this.data = companionDataSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      this.data.growth ??= structuredClone(growthDefaults);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.warning = '智能陪伴数据损坏，原文件已备份，本次使用默认状态';
      }
    }
  }
  save() {
    const text = JSON.stringify(companionDataSchema.parse(this.data), null, 2);
    // 读写使用同一限制，并为一万条中文记忆留足空间，避免可保存却无法重新加载。
    if (Buffer.byteLength(text, 'utf8') > MAX_STORE_BYTES) throw new Error('陪伴数据过大，请先导出并整理历史记录');
    const next = this.writing.then(async () => {
      const temp = `${this.file}.tmp`; await fs.writeFile(temp, text, 'utf8'); await fs.rename(temp, this.file);
    });
    this.writing = next.catch(() => {}); return next;
  }
  flush() { return this.writing; }
}
