import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// 独立可分发的零依赖 Node 插件不参与应用的 TypeScript 编译。
// @ts-expect-error standalone JavaScript plugin
import { AnkiPlugin } from '../plugins/anki-japanese/core.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-anki-')); roots.push(root);
  let now = new Date(2026, 9, 26, 20, 0).getTime(), profile = '测试用户', offline = false, failSuspend = false, failGrade = false;
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  const notes: { id: number; tags: string[]; fields: Record<string, string>; deckName: string }[] = [];
  const models = new Map<string, string[]>();
  const card = { cardId: 11, note: 10, deckName: '大肥鱼::日语', type: 2, queue: 2, due: 20, interval: 3, reps: 2, lapses: 0, mod: 4, question: '<b>猫</b>', answer: 'ねこ · 猫' };
  const request = async (_url: string, init: RequestInit) => {
    if (offline) throw new Error('offline');
    const { action, params: p } = JSON.parse(init.body as string); calls.push({ action, params: p }); let result: unknown = null;
    if (action === 'version') result = 6;
    if (action === 'getActiveProfile') result = profile;
    if (action === 'deckNames') result = ['大肥鱼::日语'];
    if (action === 'findCards') result = p.query.startsWith('nid:') ? [101] : p.query.includes('is:new') ? [] : [11];
    if (action === 'cardsInfo') result = [{ ...card }];
    if (['guiDeckReview', 'guiReviewActive', 'guiShowQuestion', 'guiShowAnswer', 'guiStartCardTimer'].includes(action)) result = true;
    if (action === 'guiCurrentCard') result = { ...card, buttons: [1, 2, 3, 4], nextReviews: ['1 分钟', '5 分钟', '1 天', '4 天'] };
    if (action === 'getReviewsOfCards') result = {};
    if (action === 'modelNames') result = [...models.keys()];
    if (action === 'createModel') models.set(p.modelName, p.inOrderFields);
    if (action === 'modelFieldNames') result = models.get(p.modelName);
    if (action === 'createDeck') result = 1;
    if (action === 'findNotes') result = notes.filter(n => n.tags.includes(p.query.slice(4))).map(n => n.id);
    if (action === 'addNote') { result = 100 + notes.length; notes.push({ ...p.note, id: result }); }
    if (action === 'suspend') { if (failSuspend) throw new Error('temporary failure'); result = true; }
    if (action === 'guiAnswerCard') { if (failGrade) throw new Error('response lost'); card.reps++; result = true; }
    return new Response(JSON.stringify({ result, error: null }), { headers: { 'Content-Type': 'application/json' } });
  };
  const plugin = new AnkiPlugin(root, { request, now: () => now }); await plugin.load();
  const invoke = (name: string, args = {}) => plugin.call(name, args, new AbortController().signal);
  const settings = async () => { const status = await invoke('anki_status'); await invoke('anki_settings_save', { settings: status.settings }); };
  return { root, plugin, invoke, settings, card, calls, notes, models, request, time: () => now, advance: (minutes: number) => { now += minutes * 60000; }, profile: (s: string) => { profile = s; }, offline: (b: boolean) => { offline = b; }, failSuspend: (b: boolean) => { failSuspend = b; }, failGrade: () => { failGrade = true; } };
}
const payload = (sessionId: string) => ({ sessionId, summary: '练习自我介绍', corrections: '助词用 は', turns: [{ user: '私は学生です。', assistant: 'いいですね。何を勉強していますか。' }], vocabulary: [{ expression: '学生<script>bad()</script>', reading: 'がくせい', meaning: '学生', example: '私は学生です。' }] });

describe('Anki 日语插件', () => {
  it('默认未绑定用户，读取无写入；离线时仍能看到计划配置与错误', async () => {
    const f = await fixture(); const status = await f.invoke('anki_status');
    expect(status.connected).toBe(true); expect(status.settings.profile).toBe('测试用户');
    expect(f.calls.some(c => c.action === 'addNote')).toBe(false);
    await expect(f.invoke('anki_practice_start', { topic: '自我介绍' })).rejects.toThrow('保存');
    f.offline(true); expect(await f.invoke('anki_status')).toMatchObject({ connected: false, summary: expect.stringContaining('请打开 Anki') });
  });
  it('计划校验、当前用户检查与重启保存；模型不能插入端点或任意动作', async () => {
    const f = await fixture(); await f.settings(); const status = await f.invoke('anki_status');
    await expect(f.invoke('anki_settings_save', { settings: { ...status.settings, time: '25:90' } })).rejects.toThrow('提醒时间');
    await expect(f.invoke('anki_settings_save', { settings: { ...status.settings, days: [] } })).rejects.toThrow();
    await expect(f.invoke('anki_settings_save', { settings: { ...status.settings, profile: '别人' } })).rejects.toThrow('当前');
    await expect(f.invoke('anki_status', { action: 'deleteDecks' })).rejects.toThrow('未知字段');
    const second = new AnkiPlugin(f.root, { request: f.request, now: f.time }); await second.load(); expect(second.state.settings.profile).toBe('测试用户');
  });
  it('真实对话记录和生词分开，HTML 转义，日志暂停；失败重试和重启不重复建卡', async () => {
    const f = await fixture(); await f.settings(); const session = await f.invoke('anki_practice_start', { topic: '自我介绍' });
    f.advance(3); f.failSuspend(true); await expect(f.invoke('anki_practice_record', payload(session.sessionId))).rejects.toThrow();
    expect(f.notes).toHaveLength(2); expect(f.notes[0].fields.Expression).toContain('&lt;script&gt;');
    expect(f.notes[1].fields.Transcript).toContain('私は学生です'); expect(f.notes[1].deckName).toBe('大肥鱼::学习记录');
    f.failSuspend(false); f.advance(8);
    const second = new AnkiPlugin(f.root, { request: f.request, now: f.time }); await second.load();
    const result = await second.call('anki_practice_record', payload(session.sessionId)); expect(result.recorded).toBe(true); expect(result.minutes).toBe(3);
    await second.call('anki_practice_record', payload(session.sessionId)); expect(f.notes).toHaveLength(2); expect(f.calls.filter(c => c.action === 'answerCards')).toHaveLength(0);
    expect(f.calls.filter(c => c.action === 'suspend').at(-1)?.params).toEqual({ cards: [101] });
  });
  it('相同生词跨轮次不重复建卡，日志保留各轮内容', async () => {
    const f = await fixture(); await f.settings();
    const one = await f.invoke('anki_practice_start', { topic: 'A' }); await f.invoke('anki_practice_record', payload(one.sessionId));
    const two = await f.invoke('anki_practice_start', { topic: 'B' }); await f.invoke('anki_practice_record', payload(two.sessionId));
    expect(one.sessionId).not.toBe(two.sessionId); expect(f.notes).toHaveLength(3);
  });
  it('切换用户时阻止写入；过期练习不虚构补记', async () => {
    const f = await fixture(); await f.settings(); const s = await f.invoke('anki_practice_start', { topic: 'A' });
    f.profile('其他用户'); await expect(f.invoke('anki_practice_record', payload(s.sessionId))).rejects.toThrow('不一致'); expect(f.notes).toHaveLength(0);
    f.profile('测试用户'); f.advance(121); await expect(f.invoke('anki_practice_record', payload(s.sessionId))).rejects.toThrow('超过两小时');
  });
  it('题面不泄露答案，显示答案后才能评分；单 token 最多一次且重启不重提', async () => {
    const f = await fixture(); await f.settings(); const review = await f.invoke('anki_review_next');
    expect(review.question).toBe('猫'); expect(review.answer).toBeUndefined();
    expect((await f.invoke('anki_review_next')).token).toBe(review.token);
    await expect(f.invoke('anki_review_grade', { token: review.token, ease: 3 })).rejects.toThrow('先显示答案');
    expect((await f.invoke('anki_review_reveal', { token: review.token })).answer).toContain('ねこ');
    expect(await f.invoke('anki_review_grade', { token: review.token, ease: 3 })).toMatchObject({ graded: true });
    const second = new AnkiPlugin(f.root, { request: f.request, now: f.time }); await second.load();
    await expect(second.call('anki_review_grade', { token: review.token, ease: 3 })).rejects.toThrow('已使用');
    expect(f.calls.filter(c => c.action === 'guiAnswerCard')).toHaveLength(1);
    expect(f.calls.filter(c => c.action === 'answerCards')).toHaveLength(0);
    expect(f.calls.filter(c => c.action === 'guiStartCardTimer')).toHaveLength(1);
  });
  it('外部复习或编辑后拒绝旧评分；超时结果不自动重试', async () => {
    const f = await fixture(); await f.settings(); const review = await f.invoke('anki_review_next'); await f.invoke('anki_review_reveal', { token: review.token });
    f.card.reps++; await expect(f.invoke('anki_review_grade', { token: review.token, ease: 2 })).rejects.toThrow('改变');
    const next = await f.invoke('anki_review_next'); await f.invoke('anki_review_reveal', { token: next.token }); f.failGrade();
    await expect(f.invoke('anki_review_grade', { token: next.token, ease: 2 })).rejects.toThrow('未确认');
    await expect(f.invoke('anki_review_grade', { token: next.token, ease: 2 })).rejects.toThrow('已使用'); expect(f.calls.filter(c => c.action === 'guiAnswerCard')).toHaveLength(1);
  });
  it('提醒只在所选学习日两小时窗口内触发，达到用时目标不再提醒，离线也可提醒', async () => {
    const f = await fixture(); expect(await f.invoke('anki_reminder')).toBeNull(); await f.settings();
    expect(await f.invoke('anki_reminder')).toMatchObject({ key: '2026-10-26:20:00' }); f.offline(true); expect(await f.invoke('anki_reminder')).not.toBeNull();
    f.offline(false); const s = await f.invoke('anki_practice_start', { topic: 'A' }); f.advance(20); await f.invoke('anki_practice_record', payload(s.sessionId)); expect(await f.invoke('anki_reminder')).toBeNull();
    f.advance(24 * 60); f.plugin.state.settings.days = [1]; expect(await f.invoke('anki_reminder')).toBeNull();
    f.plugin.state.settings.days = [2]; f.advance(121); expect(await f.invoke('anki_reminder')).toBeNull();
  });
  it('损坏状态不覆盖；取消信号阻止任何后续调用', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort();
    await expect(f.plugin.call('anki_status', {}, abort.signal)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
    await fs.writeFile(path.join(f.root, 'study.json'), '{broken'); const second = new AnkiPlugin(f.root);
    await expect(second.load()).rejects.toThrow('已保留'); expect(await fs.readFile(path.join(f.root, 'study.json'), 'utf8')).toBe('{broken');
  });
  it('工作室课堂采用稳定编号和实际用时，响应丢失后按原内容恢复且不重建词卡', async () => {
    const f = await fixture(); await f.settings(); const data = { ...payload('stable-course-session'), topic: '课堂单元', minutes: 0 };
    f.failSuspend(true); await expect(f.invoke('anki_lesson_record', data)).rejects.toThrow(); expect(f.notes).toHaveLength(2);
    const practice = await f.invoke('anki_practice_start', { topic: '普通聊天练习' }); expect(practice.sessionId.startsWith('lesson-')).toBe(false);
    f.failSuspend(false); const result = await f.invoke('anki_lesson_record', data); expect(result.minutes).toBe(0); await f.invoke('anki_lesson_record', data); expect(f.notes).toHaveLength(2);
    expect(f.calls.some(c => c.action === 'guiAnswerCard')).toBe(false);
  });
  it('原生评分显示实际间隔，HTML 块级元素保留分隔', async () => {
    const f = await fixture(); await f.settings(); f.card.question = '<div>猫</div><p>读音？</p>'; const review = await f.invoke('anki_review_next'); expect(review.question).toContain('猫\n');
    const revealed = await f.invoke('anki_review_reveal', { token: review.token }); expect(revealed.choices[3]).toEqual({ label: '良好', interval: '1 天' });
    expect(f.calls.some(c => c.action === 'findCards' && String(c.params.query).includes('is:new'))).toBe(false);
  });
});
