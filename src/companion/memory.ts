import type { Memory, RecallHit, CompanionConfig } from '../shared/companion';
// 中文按二元词组召回，英文按单词；检索实现可替换为向量索引，调用方不依赖算法。
function terms(text: string): Set<string> {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  for (const phrase of lower.match(/[\u4e00-\u9fff]+/g) ?? []) for (let i = 0; i < phrase.length - 1; i++) words.push(phrase.slice(i, i + 2));
  return new Set(words);
}
export function recallMemories(memories: Memory[], query: string, scope: 'private' | 'public', config: CompanionConfig['memory'], now: number): RecallHit[] {
  const q = terms(query);
  return memories.filter(m => !m.deletedAt && !m.supersededBy && (scope === 'private' || m.scope === 'public')).map(m => {
    const words = terms(m.text); const hits = [...q].filter(w => words.has(w));
    const relevance = q.size ? hits.length / Math.sqrt(q.size * Math.max(1, words.size)) : 0;
    const freshness = m.kind !== 'episode' || m.pinned ? 1 : 2 ** (-Math.max(0, now - (m.lastRecalledAt ?? m.eventAt)) / (config.halfLifeDays * 86400000));
    return { id: m.id, text: m.text, score: relevance * (0.6 + 0.25 * freshness + 0.15 * m.importance) + (m.pinned ? 0.05 : 0), reason: `命中 ${hits.slice(0, 5).join('、') || '固定记忆'}；${m.kind === 'episode' ? `鲜活度 ${Math.round(freshness * 100)}%` : '长期事实'}`, relevance, pinned: m.pinned };
  }).filter(m => m.relevance >= 0.08 || m.pinned).sort((a, b) => b.score - a.score).slice(0, config.recallLimit).map(({ id, text, score, reason }) => ({ id, text, score, reason }));
}
export function remember(memories: Memory[], candidate: Memory): Memory[] {
  // 删除墓碑保留，自动提炼不会把用户刚忘掉的内容又写回来。
  if (memories.some(m => m.text === candidate.text && m.scope === candidate.scope)) return memories;
  if (memories.length >= 10000) throw new Error('记忆已达到一万条，请先导出和整理');
  return [...memories.map(m => !m.deletedAt && !m.supersededBy && candidate.factKey && m.factKey === candidate.factKey && m.scope === candidate.scope ? { ...m, supersededBy: candidate.id } : m), candidate];
}
