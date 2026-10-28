import { z } from 'zod';
import type { CompanionEvent } from './companion';

export const conversationPolicySchema = z.object({ idleMinutes: z.number().int().min(5).max(1440) }).strict();
export const conversationPolicyDefaults = { idleMinutes: 30 };
export type ConversationPolicy = z.infer<typeof conversationPolicySchema>;
export type ConversationBreak = 'first' | 'day' | 'idle' | 'clock' | 'closed';
const localDay = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function conversationBreak(previousAt: number, at: number, policy: ConversationPolicy): ConversationBreak | undefined {
  if (at < previousAt) return 'clock';
  if (localDay(previousAt) !== localDay(at)) return 'day';
  if (at - previousAt >= policy.idleMinutes * 60000) return 'idle';
}
export function isConversationEvent(event: CompanionEvent) { return event.source !== 'initiative' && event.source !== 'interaction' && event.actor !== 'system'; }

// conversationId 表示渠道；sessionId 表示该渠道里的一段对话。旧记录在内存中推导分段，不删除历史。
export function sessionIndex(events: CompanionEvent[], policy: ConversationPolicy): Map<string, string> {
  const index = new Map<string, string>(); const latest = new Map<string, CompanionEvent>();
  for (const event of events) {
    if (!isConversationEvent(event)) continue;
    const previous = latest.get(event.conversationId);
    if (event.actor === 'user') {
      const same = previous && previous.sessionEndedAt === undefined && !conversationBreak(previous.at, event.at, policy);
      index.set(event.id, event.sessionId ?? (same ? index.get(previous.id)! : event.id)); latest.set(event.conversationId, event);
    } else {
      const id = event.sessionId ?? (event.causeId ? index.get(event.causeId) : undefined) ?? (previous ? index.get(previous.id) : undefined);
      if (id) index.set(event.id, id);
    }
  }
  return index;
}
export function conversationSession(events: CompanionEvent[], event: CompanionEvent, policy = conversationPolicyDefaults) {
  const position = events.findIndex(e => e.id === event.id); const previousEvents = position < 0 ? events : events.slice(0, position);
  const previous = [...previousEvents].reverse().find(e => e.conversationId === event.conversationId && e.actor === 'user' && isConversationEvent(e));
  const reason: ConversationBreak | undefined = !previous || event.actor !== 'user' ? 'first' : conversationBreak(previous.at, event.at, policy) ?? (previous.sessionEndedAt !== undefined ? 'closed' : undefined);
  const index = sessionIndex(previousEvents, policy);
  const id = event.sessionId ?? (!reason && previous ? index.get(previous.id)! : event.id);
  const history = reason ? [] : previousEvents.filter(e => e.conversationId === event.conversationId && index.get(e.id) === id && isConversationEvent(e)).slice(-20);
  return { id, reason, history, hadPrevious: Boolean(previous) };
}
