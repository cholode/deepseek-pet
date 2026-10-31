import { traitLabels, traitNames, type Growth, type GrowthObservation } from '../shared/growth';

const day = (at: number) => new Date(at).toLocaleDateString('sv-SE');
// 没开情绪/记忆提炼时，只对明显的表达反馈额外请求评价，普通寒暄和课堂答案不增加调用。
export function mayExpressFeedback(text: string) {
  return /(?:说|讲|解释|回复|回答|语气|态度|表达|主动|温柔|俏皮|幽默).{0,18}(?:短|长|详细|简洁|温柔|严肃|主动|喜欢|希望|太|一点|一些)|(?:希望|请|喜欢|不喜欢).{0,18}(?:说|讲|语气|主动|温柔|幽默)|(?:be|speak|reply|explain).{0,20}(?:brief|concise|gentle|playful|detailed)|(?:もっと|もう少し).{0,10}(?:優しく|短く|詳しく)/iu.test(text);
}
// 性格是慢变量，短期情绪是快变量。三次不同对话中的同向反馈才积累一个小步；
// 每个维度每天最多变化两点，用户锁定的维度永远不被自动评价覆盖。
export function grow(current: Growth, observations: GrowthObservation[], eventId: string, userText: string, now: number): Growth {
  if (!current.enabled || current.processed.includes(eventId)) return current;
  const state = structuredClone(current);
  state.processed = [...state.processed, eventId].slice(-1000);
  for (const trait of traitNames) {
    if (state.locked.includes(trait)) continue;
    const observation = observations.find(o => o.trait === trait && userText.includes(o.evidence));
    if (!observation) continue;
    state.observations = [...state.observations.filter(o => now - o.at < 30 * 86400000), { ...observation, eventId, at: now }].slice(-100);
    const recent = state.observations.filter(o => o.trait === trait).slice(-3);
    if (recent.length < 3 || !recent.every(o => o.direction === observation.direction) || new Set(recent.map(o => o.eventId)).size < 3) continue;
    const today = state.history.filter(h => h.trait === trait && day(h.at) === day(now)).length;
    if (today >= 2) continue;
    const before = { ...state.values };
    state.values[trait] = Math.max(10, Math.min(90, state.values[trait] + observation.direction));
    if (state.values[trait] === before[trait]) continue;
    state.history = [...state.history, { id: `${eventId}:${trait}`, at: now, before, after: { ...state.values }, trait, reason: observation.reason, evidence: recent.map(o => o.evidence) }].slice(-100);
    state.observations = state.observations.filter(o => o.trait !== trait);
  }
  return state;
}
export function rollbackGrowth(current: Growth, id: string, now: number): Growth {
  const item = current.history.find(h => h.id === id); if (!item) throw new Error('成长记录不存在');
  // 回退也留记录；清空待累积反馈，避免刚回退就被旧证据自动改回去。
  return { ...current, values: { ...item.before }, observations: [], history: [...current.history, { id: `rollback:${now}`, at: now, before: { ...current.values }, after: { ...item.before }, reason: '用户回退到这次变化之前', evidence: [] }].slice(-100) };
}
export function growthContext(growth?: Growth): string {
  if (!growth?.enabled) return '';
  return `长期表达习惯（0–100，仅调整语气，不改变基本身份、事实和工具权限）：${traitNames.map(t => `${traitLabels[t]} ${growth.values[t]}`).join('，')}。高温柔度多用温和回应，高俏皮度允许轻松玩笑，高主动度可提出相关建议，高详细度可多作解释。用户当前要求优先，严肃情境适度；不要提分数或假装拥有真实人类经历。`;
}
