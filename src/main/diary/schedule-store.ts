import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { diaryDateSchema, diaryDay } from '../../shared/diary';
import { shiftDiaryDay } from '../../companion/diary-schedule';

const scheduleSchema = z.object({
  version: z.literal(1), startedDate: diaryDateSchema, nextDate: diaryDateSchema,
  lastWrittenDate: diaryDateSchema.optional(), retryAt: z.number().finite().min(0), error: z.string().max(2000).optional(),
  pending: z.object({ date: diaryDateSchema, directory: z.string().max(1000).refine(path.isAbsolute), entry: z.string().min(1).max(20000) }).strict().optional()
}).strict().refine(value => value.nextDate >= value.startedDate && (!value.pending || value.pending.date === value.nextDate), '自动日记进度无效');
export type DiarySchedule = z.infer<typeof scheduleSchema>;

// 小型持久化队列：先保存待提交正文，写入日期文件后才推进日期。
// 若进程恰好在两次提交之间退出，正文中的自动标记负责去重，避免再次调用模型。
export class DiaryScheduleStore {
  state: DiarySchedule;
  constructor(readonly file: string, now: number) {
    const date = diaryDay(now); this.state = { version: 1, startedDate: date, nextDate: date, retryAt: 0 };
  }
  async load() {
    try {
      const stat = await fs.stat(this.file); if (stat.size > 128000) throw new Error('自动日记进度过大');
      this.state = scheduleSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.state.error = '自动日记进度损坏，已备份；从今天重新检查，已有日记不会覆盖。';
      }
      await this.save(this.state);
    }
  }
  async save(next: DiarySchedule) {
    const parsed = scheduleSchema.parse(next);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8'); await fs.rename(temp, this.file);
    this.state = parsed;
  }
  async complete(date: string) {
    await this.save({ ...this.state, nextDate: shiftDiaryDay(date, 1), lastWrittenDate: date, pending: undefined, retryAt: 0, error: undefined });
  }
}
