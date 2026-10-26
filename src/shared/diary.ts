import { z } from 'zod';

// 只暴露日记操作，不向页面提供任意文件读写或 shell 接口。
export const diarySettingsSchema = z.object({ directory: z.string().trim().max(1000) }).strict();
export const diaryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && diaryDay(date.getTime()) === value;
}, '日期无效');
export function diaryDay(now: number) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const diaryRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('refresh') }).strict(),
  z.object({ type: z.literal('write') }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
  z.object({ type: z.literal('read'), date: diaryDateSchema }).strict(),
  z.object({ type: z.literal('set-directory'), directory: diarySettingsSchema.shape.directory }).strict(),
  z.object({ type: z.literal('choose-directory') }).strict(),
  z.object({ type: z.literal('open-directory') }).strict()
]);
export type DiaryRequest = z.infer<typeof diaryRequestSchema>;
export interface DiaryView {
  directory: string; defaultDirectory: string; customDirectory: boolean; busy: boolean;
  files: { date: string; name: string }[];
  selectedDate?: string; content: string; notice?: string;
  automatic: { time: '21:00'; startedDate: string; nextDate: string; lastWrittenDate?: string; waitingDays: number; retryAt: number; writingDate?: string; error?: string };
}
export interface DiaryResponse { ok: boolean; message?: string; state: DiaryView }
export interface DiaryBridge {
  diary(request: DiaryRequest): Promise<DiaryResponse>;
  onDiary(fn: (state: DiaryView) => void): () => void;
}
