import { emotionNames, type Emotion, type Mood, type CompanionConfig } from '../shared/companion';
const clamp = (n: number, low = 0, high = 100) => Math.min(high, Math.max(low, n));
export function initialMood(now: number, baseline = 70): Mood {
  return { value: baseline, updatedAt: now, emotions: Object.fromEntries(emotionNames.map(e => [e, 0])) as Record<Emotion, number>, timeline: [] };
}
// 用真实时间计算衰减，内部始终保留小数，避免高频轮询把微小变化四舍五入掉。
export function decayMood(mood: Mood, config: CompanionConfig['mood'], now: number): Mood {
  const age = Math.max(0, now - mood.updatedAt);
  return { ...mood, value: config.baseline + (mood.value - config.baseline) * 2 ** (-age / (config.halfLifeHours * 3600000)),
    emotions: Object.fromEntries(emotionNames.map(e => [e, mood.emotions[e] * 2 ** (-age / 5400000)])) as Record<Emotion, number>, updatedAt: Math.max(mood.updatedAt, now) };
}
export function applyEmotion(mood: Mood, eventId: string, emotion: Emotion, delta: number, reason: string, confidence: number, config: CompanionConfig['mood'], now: number): Mood {
  const next = decayMood(mood, config, now);
  // 同一外部事件只评价一次；低可信度结论不能先修改状态、再仅隐藏提示。
  if (!config.enabled || confidence < 0.65 || mood.timeline.some(x => x.eventId === eventId)) return next;
  const step = clamp(delta, -8, 8);
  next.value = clamp(next.value + step / 3);
  next.emotions = { ...next.emotions, [emotion]: clamp(next.emotions[emotion] + Math.max(2, Math.abs(step))) };
  next.timeline = [...next.timeline, { eventId, at: now, reason: reason.slice(0, 160), delta: step / 3, emotion }].slice(-100);
  return next;
}
