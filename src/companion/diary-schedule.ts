import { diaryDay } from '../shared/diary';

// 使用本地日历推进，不能用固定 24 小时处理夏令时和跨月日期。
export function shiftDiaryDay(day: string, count: number) {
  const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + count);
  return diaryDay(date.getTime());
}
export function diaryDueDate(now: number) {
  const today = diaryDay(now);
  return now >= new Date(`${today}T21:00:00`).getTime() ? today : shiftDiaryDay(today, -1);
}
export function diaryWaitingDays(nextDate: string, now: number) {
  const due = diaryDueDate(now);
  return nextDate > due ? 0 : Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${nextDate}T00:00:00Z`)) / 86400000) + 1;
}
export function diaryWakeDelay(nextDate: string, retryAt: number, now: number) {
  const dueAt = new Date(`${nextDate}T21:00:00`).getTime();
  // 最长30秒重查一次壁钟，调时/更换时区后不会依赖旧的长定时器。
  return Math.max(1000, Math.min(30000, Math.max(dueAt, retryAt) - now));
}
