import type { CompanionData, Goal } from '../shared/companion';
export interface InitiativeOpportunity { topic: string; goal?: Goal }
export function localDay(now: number): string { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
// 先检查能否打扰，再选择有依据的话题。没有动机就安静，不凭空掷骰催用户互动。
export function chooseInitiative(data: CompanionData, now: number, busy: boolean, lastInteractionAt: number): InitiativeOpportunity | undefined {
  const c = data.config.initiative; const hour = new Date(now).getHours();
  const quiet = c.quietStart !== c.quietEnd && (c.quietStart < c.quietEnd ? hour >= c.quietStart && hour < c.quietEnd : hour >= c.quietStart || hour < c.quietEnd);
  if (!data.config.enabled || !c.enabled || busy || quiet || now - lastInteractionAt < c.idleMinutes * 60000 || now - data.initiative.lastAt < c.cooldownMinutes * 60000) return;
  if (data.initiative.day === localDay(now) && data.initiative.count >= c.dailyLimit) return;
  const goal = data.goals.find(g => !g.completed && g.dueAt <= now && (!g.lastAttemptAt || now - g.lastAttemptAt > 86400000));
  if (goal) return { topic: `你记着这件尚未完成的约定：${goal.text}。现在到约定时间了，简短提醒，不能声称已经完成。`, goal };
  const episode = [...data.memories].reverse().find(m => m.kind === 'episode' && !m.deletedAt && !m.supersededBy && m.id !== data.initiative.lastTopic && now - m.eventAt < 7 * 86400000);
  if (episode) return { topic: `可以围绕这段真实共同经历自然搭一句话：${episode.text}。不合适就输出 [安静]。`, goal: undefined };
  return;
}
