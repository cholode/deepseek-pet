import { describe, expect, it, vi } from 'vitest';
import { conversationBreak, conversationPolicyDefaults as policy, conversationSession, sessionIndex } from '../src/shared/conversation-session';
import { voiceConfigSchema, voiceDefaults } from '../src/shared/voice';
import { companionDataSchema, type CompanionEvent } from '../src/shared/companion';
import { buildContext } from '../src/companion/context';
import { CompanionCoordinator } from '../src/companion/coordinator';
import { fixture, memory } from './companion-fixture';

const time = new Date(2026, 9, 28, 12).getTime();
const event = (id: string, at: number, patch: Partial<CompanionEvent> = {}): CompanionEvent => ({ id, at, actor: 'user', source: 'desktop', conversationId: 'desktop', text: id, ...patch });
describe('conversation boundaries', () => {
  it('ends at local midnight even with less than a minute of silence', () => {
    const previous = new Date(2026, 9, 27, 23, 59, 50).getTime(); const next = new Date(2026, 9, 28, 0, 0, 10).getTime();
    expect(conversationBreak(previous, next, policy)).toBe('day');
    expect(conversationSession([event('昨日问题', previous)], event('早上好', next)).history).toEqual([]);
  });
  it('keeps an ongoing same-day conversation and ends exactly at the idle threshold', () => {
    const old = event('old', time); const reply = event('reply', time + 5000, { actor: 'pet', causeId: 'old' });
    expect(conversationSession([old, reply], event('next', time + 30 * 60000 - 1)).history).toEqual([old, reply]);
    expect(conversationSession([old, reply], event('next', time + 30 * 60000)).reason).toBe('idle');
  });
  it('counts user messages, never assistant replies or reminders', () => {
    const history = [event('user', time), event('late reply', time + 29 * 60000, { actor: 'pet' }), event('reminder', time + 29 * 60000, { source: 'initiative', actor: 'system' })];
    expect(conversationSession(history, event('new', time + 31 * 60000)).history).toEqual([]);
  });
  it('a later user message extends the current session, with no fixed total duration', () => {
    const history = Array.from({ length: 6 }, (_, i) => event(`u${i}`, time + i * 20 * 60000));
    const session = conversationSession(history, event('next', time + 120 * 60000)); expect(session.id).toBe('u0'); expect(session.history).toHaveLength(6);
  });
  it('does not reattach earlier legacy sessions when the newest message is recent', () => {
    const history = [event('old question', time), event('old answer', time + 1000, { actor: 'pet' }), event('new question', time + 40 * 60000), event('new answer', time + 40 * 60000 + 1000, { actor: 'pet' })];
    expect(conversationSession(history, event('continue', time + 41 * 60000)).history.map(e => e.id)).toEqual(['new question', 'new answer']);
  });
  it('keeps explicit session boundaries after changing the timeout and across restart', () => {
    const history = [event('old', time, { sessionId: 'first', sessionEndedAt: time + 30 * 60000 }), event('new', time + 40 * 60000, { sessionId: 'second' })];
    expect(conversationSession(history, event('next', time + 41 * 60000), { idleMinutes: 120 }).history.map(e => e.id)).toEqual(['new']);
    expect(conversationSession(history.slice(0, 1), event('next', time + 31 * 60000), { idleMinutes: 120 }).reason).toBe('closed');
  });
  it('isolates channels and does not let an unrelated QQ message refresh desktop activity', () => {
    const history = [event('desktop', time), event('qq-secret', time + 29 * 60000, { conversationId: 'qq:private:1', source: 'qq-private' })];
    expect(conversationSession(history, event('new', time + 31 * 60000)).history).toEqual([]);
    expect(conversationSession(history, event('qq-next', time + 30 * 60000, { conversationId: 'qq:private:1', source: 'qq-private' })).history.map(e => e.id)).toEqual(['qq-secret']);
  });
  it('clock rollback and proactive prompts never reuse an old active dialogue', () => {
    expect(conversationSession([event('future', time + 1000)], event('now', time)).reason).toBe('clock');
    expect(conversationSession([event('user', time)], event('wake', time + 1000, { source: 'initiative', actor: 'system' })).history).toEqual([]);
  });
  it('ties assistant messages to the source session and limits only its recent context', () => {
    const history = Array.from({ length: 25 }, (_, i) => event(`u${i}`, time + i * 1000, { sessionId: 'current' }));
    history.push(event('late-old-reply', time + 26000, { actor: 'pet', sessionId: 'old' }));
    const session = conversationSession(history, event('new', time + 27000)); expect(session.history).toHaveLength(20); expect(session.history.at(-1)?.id).toBe('u24'); expect(sessionIndex(history, policy).get('late-old-reply')).toBe('old');
  });
  it('loads old voice settings without losing credentials or requiring a reset', () => {
    const { session: _session, ...old } = voiceDefaults; const parsed = voiceConfigSchema.parse(old); expect(parsed.session.idleMinutes).toBe(30);
    expect(voiceConfigSchema.safeParse({ ...old, session: { idleMinutes: 0 } }).success).toBe(false);
  });
});

describe('conversation context and cancellation', () => {
  it('excludes stale questions while keeping long-term memories and real plans', () => {
    const f = fixture(); f.data.events = [event('把昨天这张卡评分为简单', time - 86400000)];
    f.data.goals.push({ id: 'plan', text: '每天练习日语', dueAt: time, completed: false }); const now = event('你好', time);
    const context = buildContext(f.data, now, [{ id: 'memory', text: '用户喜欢日语', score: 1, reason: '长期偏好' }]);
    expect(context.filter(m => m.role !== 'system')).toEqual([{ role: 'user', content: '你好' }]);
    const prompt = context.map(m => m.content).join('\n'); expect(prompt).toContain('用户喜欢日语'); expect(prompt).toContain('每天练习日语'); expect(prompt).toContain('不是当前任务或继续执行的授权'); expect(prompt).toContain('"newSession":true');
  });
  it('persists closed sessions and starts a fresh session after restart without deleting learning data', async () => {
    const f = fixture(); let now = time; f.host.now = () => now; f.data.config.memory.automatic = false; f.data.config.mood.enabled = false;
    f.model.complete.mockResolvedValue({ text: '你好', calls: [] }); f.data.memories.push(memory({ kind: 'preference', text: '用户喜欢日语', pinned: true }));
    await f.coordinator.chat('昨天的问题'); const first = f.data.events[0].sessionId; now += 31 * 60000; f.coordinator.expireConversations();
    expect(f.data.events[0].sessionEndedAt).toBe(now); const saved = companionDataSchema.parse(JSON.parse(JSON.stringify(f.data)));
    f.repository.data = saved; const restarted = new CompanionCoordinator(f.repository, f.model, f.tools, f.host);
    await restarted.chat('你好', 'desktop', 'after-restart'); const messages = f.model.complete.mock.calls.at(-1)![0];
    expect(messages.filter(m => m.role !== 'system')).toEqual([{ role: 'user', content: '你好' }]);
    expect(saved.events.find(e => e.id === 'after-restart')?.sessionId).not.toBe(first); expect(saved.events.some(e => e.text === '昨天的问题')).toBe(true); expect(saved.memories).toHaveLength(1); expect(restarted.notice).toContain('新一段');
    now += 60000; await restarted.chat('继续聊', 'desktop', 'follow-up'); expect(f.model.complete.mock.calls.at(-1)![0].filter(m => m.role !== 'system').map(m => m.content)).toEqual(['你好', '你好', '继续聊']);
  });
  it('aborts an idle tool turn and rejects late tool calls even if the provider ignores cancellation', async () => {
    const f = fixture(); let now = time; f.host.now = () => now; f.data.config.mcp.enabled = true; f.data.config.mcp.allowedTools = ['operate'];
    f.tools.list.mockResolvedValue([{ name: 'operate', description: '', inputSchema: {} }]);
    let resolve!: (result: { text: string; calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }) => void;
    f.model.complete.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const pending = f.coordinator.chat('开始操作');
    await vi.waitFor(() => expect(f.model.complete).toHaveBeenCalled()); now += 30 * 60000; f.coordinator.expireConversations();
    expect(f.model.complete.mock.calls[0][2].aborted).toBe(true); expect(f.coordinator.busy).toBe(false);
    resolve({ text: '', calls: [{ id: 'late', type: 'function', function: { name: 'operate', arguments: '{}' } }] });
    expect(await pending).toBe(''); expect(f.tools.call).not.toHaveBeenCalled(); expect(f.data.events.filter(e => e.actor === 'pet')).toHaveLength(0);
  });
  it('checks expiration again when a result arrives, without depending on the background timer', async () => {
    const f = fixture(); let now = new Date(2026, 9, 27, 23, 59, 59).getTime(); f.host.now = () => now;
    f.model.complete.mockImplementationOnce(async () => { now += 2000; return { text: '跨天的迟到回复', calls: [] }; });
    expect(await f.coordinator.chat('睡前问题')).toBe(''); expect(f.data.events.filter(e => e.actor === 'pet')).toHaveLength(0);
  });
  it('does not keep writing an already closed session on every idle tick', async () => {
    const f = fixture(); f.host.now = () => time; f.data.events = [event('old', time - 31 * 60000)];
    f.coordinator.expireConversations(); f.coordinator.expireConversations(); await Promise.resolve(); expect(f.repository.save).toHaveBeenCalledTimes(1); expect(f.host.present).not.toHaveBeenCalled();
  });
  it('keeps the boundary when saving fails and reports the storage error', async () => {
    const f = fixture(); f.host.now = () => time; f.data.events = [event('old', time - 31 * 60000)];
    f.repository.save = vi.fn(() => { throw new Error('磁盘不可用'); }); f.coordinator.expireConversations();
    await vi.waitFor(() => expect(f.coordinator.error).toBe('对话结束状态未能保存'));
    expect(f.data.events[0].sessionEndedAt).toBe(time);
  });
});
