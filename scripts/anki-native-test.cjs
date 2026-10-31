// 只允许既有隔离审计 profile，绝不在用户真实 Anki 集合中造测试卡。
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('test-results/anki-audit'); const runtime = JSON.parse(await fs.readFile(path.join(root, 'anki-runtime.json'), 'utf8'));
  assert.equal(runtime.profile, 'DaFeiYu-20word-Audit'); assert.equal(path.resolve(runtime.base), path.join(root, 'isolated-anki'));
  const api = async (action, params = {}) => { const response = await fetch(`http://127.0.0.1:${runtime.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params, version: 6 }), signal: AbortSignal.timeout(15000) }); const value = await response.json(); if (value.error) throw new Error(`${action}: ${value.error}`); return value.result; };
  assert.equal(await api('getActiveProfile'), runtime.profile);
  const { AnkiPlugin } = await import('../plugins/anki-japanese/core.mjs'); const directory = await fs.mkdtemp(path.join(root, 'native-review-')); const plugin = new AnkiPlugin(directory); await plugin.load(); plugin.state.settings.port = runtime.port;
  const deck = `NativeQueue-${Date.now()}`; const checks = []; const check = text => { checks.push(text); console.log('PASS', text); };
  const invoke = (name, args = {}) => plugin.call(name, args, new AbortController().signal);
  await invoke('anki_settings_save', { settings: { ...plugin.state.settings, profile: runtime.profile, deck, reviewDeck: deck, logDeck: `${deck}-logs`, newCards: 10 } });
  const payload = { sessionId: `native-lesson-${Date.now()}`, topic: '隔离课程测试', summary: '测试脚本完成猫、犬两词。', corrections: '', turns: [{ user: 'ねこ', assistant: '读音正确' }, { user: 'いぬ', assistant: '读音正确' }], minutes: 1, vocabulary: [{ expression: '猫', reading: 'ねこ', meaning: '猫', example: '猫は動物です。' }, { expression: '犬', reading: 'いぬ', meaning: '狗', example: '犬は動物です。' }] };
  const one = await invoke('anki_lesson_record', payload); const repeated = await invoke('anki_lesson_record', payload); assert.deepEqual(one, repeated); assert.equal(one.vocabularyNoteIds.length, 2); const cards = await api('findCards', { query: `deck:"${deck}"` }); assert.equal(cards.length, 2); check('真实 Anki 课程日志和生词分开保存，同一课堂重试不重复');
  const review = await invoke('anki_review_next'); const native = await api('guiCurrentCard'); assert.equal(review.question, '猫'); assert.equal(native.cardId, plugin.state.reviews.at(-1).cardId); assert.equal(review.answer, undefined); check('插件取题与 Anki 当前原生队列卡片一致，题面不泄露答案');
  await new Promise(r => setTimeout(r, 1200)); const answer = await invoke('anki_review_reveal', { token: review.token }); assert.ok(answer.answer.includes('ねこ')); assert.ok(Object.values(answer.choices).every(v => typeof v.interval === 'string')); check('评分选项和预计间隔直接来自 Anki 原生当前卡片');
  const selected = Number(Object.keys(answer.choices).includes('3') ? '3' : Object.keys(answer.choices)[0]); const graded = await invoke('anki_review_grade', { token: review.token, ease: selected }); assert.equal(graded.graded, true);
  const records = await api('getReviewsOfCards', { cards: [graded.cardId] }); const row = records[graded.cardId].at(-1); assert.equal(row.ease, selected); assert.ok(row.time >= 1000, `真实 revlog 计时：${row.time}`); check('原生评分真实写入 revlog，计时大于 1 秒，不再是 0');
  await assert.rejects(invoke('anki_review_grade', { token: review.token, ease: selected }), /已使用/);
  const status = await invoke('anki_status'); assert.equal(status.reviewStats.count, 1); assert.equal(status.reviewStats.cards, 1); assert.ok(status.reviewStats.timeMs >= 1000); check('状态分别报告实际复习次数、不同卡片数和 Anki 记录用时');
  await fs.writeFile(path.join(root, 'native-review-report.json'), JSON.stringify({ at: new Date().toISOString(), checks, realAnki: true, isolatedProfile: runtime.profile, scriptedAnswers: true, deck, recordedElapsedMs: row.time, statistics: status.reviewStats }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
