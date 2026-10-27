// 显式用户要求下的 20 词体验：独立真实 Anki profile + Windows 小屋。
// --scripted-model 使用本地协议驱动器；仅验证工具链，不评估真实模型质量或延迟。
// 所有作答是测试脚本的预设表现，不代表人类掌握程度或学习效果实验。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const words = [
  ['猫', 'ねこ', '猫'], ['犬', 'いぬ', '狗'], ['水', 'みず', '水'], ['本', 'ほん', '书'], ['学校', 'がっこう', '学校'],
  ['先生', 'せんせい', '老师'], ['学生', 'がくせい', '学生'], ['友達', 'ともだち', '朋友'], ['今日', 'きょう', '今天'], ['明日', 'あした', '明天'],
  ['昨日', 'きのう', '昨天'], ['食べる', 'たべる', '吃'], ['飲む', 'のむ', '喝'], ['行く', 'いく', '去'], ['来る', 'くる', '来'],
  ['見る', 'みる', '看'], ['聞く', 'きく', '听'], ['読む', 'よむ', '读'], ['書く', 'かく', '写'], ['話す', 'はなす', '说话']
];
(async () => {
  const root = path.resolve('test-results/anki-audit'), runtime = JSON.parse(await fs.readFile(path.join(root, 'anki-runtime.json'), 'utf8'));
  assert.equal(runtime.profile, 'DaFeiYu-20word-Audit');
  const api = async (action, params = {}) => { const r = await fetch(`http://127.0.0.1:${runtime.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: 6, params }), signal: AbortSignal.timeout(15000) }); const data = await r.json(); if (data.error) throw new Error(`${action}: ${data.error}`); return data.result; };
  assert.equal(await api('getActiveProfile'), runtime.profile);
  const run = await fs.mkdtemp(path.join(root, 'trial-')), userDir = path.join(run, 'user'); await fs.mkdir(userDir);
  const original = path.join(process.env.APPDATA, 'deepblue-desktop-pet');
  const source = JSON.parse(await fs.readFile(path.join(original, 'companion.json'), 'utf8'));
  const config = source.config; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.qq.enabled = false; config.mcp.enabled = false; config.speech.enabled = false;
  let scriptedServer;
  const scripted = process.argv.includes('--scripted-model');
  if (scripted) {
    scriptedServer = http.createServer((req, res) => { void (async () => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
      const user = body.messages.filter(m => m.role === 'user').at(-1).content;
      const messages = body.messages.filter(m => m.role === 'tool');
      const last = messages.length ? JSON.parse(JSON.parse(messages.at(-1).content).content[0].text) : undefined;
      const call = (name, args) => { const tool = body.tools.find(t => t.function.description.includes(`能力：${name}。`)); return { content: null, tool_calls: [{ id: `audit-${Date.now()}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] }; };
      let message;
      if (user.includes('先结束')) message = !last ? call('anki_status', {}) : { content: `当前到期 ${last.due} 张，对话用时 ${last.minutes} 分钟。状态工具未提供正式复习完成数。` };
      else if (user.includes('先从第一题') || user.includes('取下一张')) message = !last ? call('anki_review_next', {}) : { content: last.done ? last.message : `${last.question}\n请回答读音和中文意思。` };
      else if (/选择 [1-4]/.test(user)) message = !last ? call('anki_status', {}) : last.review ? call('anki_review_grade', { token: last.review[0].token, ease: Number(user.match(/选择 ([1-4])/)[1]) }) : { content: `评分已提交。${last.message}` };
      else message = !last ? call('anki_status', {}) : last.review ? call('anki_review_reveal', { token: last.review[0].token }) : { content: `${last.answer}\n请选择 1 重来、2 困难、3 良好、4 简单。` };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
    })().catch(e => { res.writeHead(500).end(JSON.stringify({ error: e.message })); }); });
    await new Promise(r => scriptedServer.listen(0, '127.0.0.1', r)); config.model.baseUrl = `http://127.0.0.1:${scriptedServer.address().port}/v1`; config.model.model = 'scripted-protocol-driver';
  }
  await fs.writeFile(path.join(userDir, 'companion.json'), JSON.stringify({ ...source, config, events: [], memories: [], goals: [], processedIds: [], qqCursor: 0 }));
  if (!scripted) {
    const secrets = JSON.parse(await fs.readFile(path.join(original, 'companion-secrets.json'), 'utf8'));
    await fs.writeFile(path.join(userDir, 'companion-secrets.json'), JSON.stringify({ model: secrets.model }));
  }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: day, nextDate: day, retryAt: 0 }));
  const deck = `大肥鱼体验::20词-${path.basename(run)}`;
  const deckId = await api('createDeck', { deck });
  const modelName = '大肥鱼体验词表';
  if (!(await api('modelNames')).includes(modelName)) await api('createModel', { modelName, inOrderFields: ['Key', 'Expression', 'Reading', 'Meaning'], cardTemplates: [{ Name: '读音与释义', Front: '{{Expression}}<br>请回忆读音和中文意思', Back: '{{FrontSide}}<hr id="answer">{{Reading}}<br>{{Meaning}}' }] });
  const noteIds = await api('addNotes', { notes: words.map((w, i) => ({ deckName: deck, modelName, fields: { Key: `${path.basename(run)}-${i}`, Expression: w[0], Reading: w[1], Meaning: w[2] }, tags: ['dafeiyu-audit'], options: { allowDuplicate: false } })) });
  assert.equal(noteIds.filter(Boolean).length, 20);
  const cards = await api('findCards', { query: `deck:"${deck}"` }); const cardInfo = await api('cardsInfo', { cards });
  const byCard = new Map(cardInfo.map(c => [c.cardId, { index: noteIds.indexOf(c.note), word: words[noteIds.indexOf(c.note)] }]));
  const report = { run, startedAt: new Date().toISOString(), model: config.model.model, realModel: !scripted, realAnki: true, simulatedLearner: true, deck, words, deckConfig: await api('getDeckConfig', { deck }), turns: [], attempts: [], issues: [], screenshots: [] };
  const save = async () => { await fs.writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'latest-trial.json'), JSON.stringify({ run, report: path.join(run, 'report.json') })); };
  await save(); console.log('Audit run:', run);
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel, dataFile;
  const wait = async (predicate, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('等待实际模型或窗口超时'); };
  try {
    app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/DeepBlue Desktop Pet.exe'), args: ['--panel'], env }); await app.firstWindow();
    await wait(() => app.windows().some(p => p.url().includes('page=panel'))); panel = app.windows().find(p => p.url().includes('page=panel'));
    const request = async value => { const r = await panel.evaluate(value => window.pet.software(value), value); if (!r.ok) throw new Error(r.message); return r; };
    await request({ type: 'install-bundled', id: 'dafeiyu.anki-japanese' });
    const saved = await request({ type: 'save', software: { name: '20词真实体验', directory: 'D:\\anki\\app', pluginId: 'dafeiyu.anki-japanese', runtimePath: '', url: '' } }); const id = saved.state.entries[0].id;
    const dataDir = path.join(userDir, 'software-data', id); await fs.mkdir(dataDir, { recursive: true }); dataFile = path.join(dataDir, 'study.json');
    await fs.writeFile(dataFile, JSON.stringify({ version: 1, settings: { profile: runtime.profile, level: 'N5', dailyMinutes: 20, newCards: 20, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6], deck, reviewDeck: deck, logDeck: `${deck}记录`, port: runtime.port }, sessions: [], reviews: [] }));
    const connected = await request({ type: 'connect', id }); await request({ type: 'grant', id, tools: connected.state.entries[0].tools.map(t => t.name) });
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '和她聊天', exact: true }).click();
    const state = () => panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state);
    const study = async () => JSON.parse(await fs.readFile(dataFile, 'utf8'));
    async function say(text, stage) {
      const before = await state(), count = before.data.events.length, start = Date.now();
      await panel.getByLabel('对大肥鱼说', { exact: true }).fill(text); await panel.getByRole('button', { name: '发送', exact: true }).click();
      await wait(async () => { const s = await state(); return !s.busy && s.data.events.length > count; });
      const after = await state(); const reply = after.data.events.slice(count).filter(e => e.actor === 'pet').map(e => e.text).join('\n');
      const activity = (await request({ type: 'state' })).state.activities;
      report.turns.push({ stage, at: new Date(start).toISOString(), user: text, reply, ms: Date.now() - start, error: after.error, toolCalls: activity.slice(-5) }); await save();
      console.log(JSON.stringify({ stage, seconds: Math.round((Date.now() - start) / 1000), reply: reply.slice(0, 380), error: after.error }));
      if (after.error || !reply) throw new Error(after.error || '实际模型未返回回复');
      return reply;
    }
    await say('这是独立试学。我是 N5 初学者，想逐张练习当前 Anki 牌组的20个单词，回忆读音和中文意思。请用插件取题，一次只出一题，等我回答再显示答案，然后等我自己评分。先从第一题开始。', 'start');
    const seen = new Map();
    for (let attempt = 0; attempt < 50 && seen.size < 20; attempt++) {
      let local = await study(), review = local.reviews.find(r => !r.consumed && Date.now() - r.at < 3600000);
      if (!review) { await say('请从 Anki 取下一张卡片，只出题，不提前给答案。', 'next'); local = await study(); review = local.reviews.find(r => !r.consumed && Date.now() - r.at < 3600000); }
      if (!review) { report.issues.push('请求下一题后没有生成实际复习凭据'); throw new Error('未实际取卡'); }
      const item = byCard.get(review.cardId); if (!item) throw new Error('题目不在隔离的20词牌组');
      const repeat = seen.has(review.cardId), index = item.index; const previous = seen.get(review.cardId) || 0;
      const mode = !repeat && [2, 7, 12, 17].includes(index) ? 'wrong' : !repeat && [5, 14].includes(index) ? 'slow' : !repeat && [0, 9].includes(index) ? 'easy' : 'good';
      const answer = mode === 'wrong' ? '这题我想不起来了，先看答案吧。' : `${item.word[1]}，意思是${item.word[2]}。${mode === 'slow' ? '想了比较久才想起来。' : ''}`;
      if (review.revealed) report.issues.push(`第${attempt + 1}次：回答前已标记揭示答案 ${item.word[0]}`);
      const answerReply = await say(answer, `answer-${index + 1}`);
      local = await study(); let current = local.reviews.find(r => r.token === review.token);
      if (current.consumed) { report.issues.push(`用户评分前已消耗 token：${item.word[0]}`); }
      else {
        if (!current.revealed) { report.issues.push(`回答后未调用揭示工具，需追问：${item.word[0]}`); await say('请调用 Anki 的揭示答案工具，再给我自评选项。', 'recover-reveal'); }
        const ease = mode === 'wrong' ? 1 : mode === 'slow' ? 2 : mode === 'easy' ? 4 : 3;
        await say(`我看过答案了，这题选择 ${ease}（${['', '重来', '困难', '良好', '简单'][ease]}），请记录这个评分。`, `grade-${index + 1}`);
        local = await study(); current = local.reviews.find(r => r.token === review.token);
        if (current.consumed !== 'graded') { report.issues.push(`自评后没有确认写入：${item.word[0]}`); await say(`请实际调用评分工具提交刚才这一题的 ${ease} 分，不要只口头确认。`, 'recover-grade'); }
      }
      seen.set(review.cardId, previous + 1);
      report.attempts.push({ word: item.word, cardId: review.cardId, token: review.token, mode, repeat, answerReply }); report.uniqueWords = seen.size;
      if (!repeat && [1, 5, 10, 15, 20].includes(seen.size)) { const shot = path.join(run, `words-${seen.size}.png`); await panel.screenshot({ path: shot }); report.screenshots.push(shot); }
      await save(); console.log(`PROGRESS ${seen.size}/20 unique words; ${report.attempts.length} attempts`);
    }
    report.completedAt = new Date().toISOString(); report.cardsAfter = await api('cardsInfo', { cards }); report.reviewHistory = await api('getReviewsOfCards', { cards });
    const records = Object.values(report.reviewHistory).flat();
    const repeatGaps = Object.values(report.reviewHistory).flatMap(rows => rows.slice(1).map((row, index) => ({ actualSeconds: (row.id - rows[index].id) / 1000, scheduledInterval: rows[index].ivl })));
    report.metrics = { uniqueWords: report.uniqueWords, reviews: records.length, zeroTimeReviews: records.filter(row => row.time === 0).length, repeatGaps, ratings: records.reduce((counts, row) => ({ ...counts, [row.ease]: (counts[row.ease] || 0) + 1 }), {}) };
    report.finished = report.uniqueWords === 20; await say('先结束本次试学。请根据插件里实际记录总结今天的进度、容易混淆的单词和接下来该怎么复习，不要把尚未做过的练习算进去。', 'summary');
    await save(); assert.equal(report.finished, true);
  } catch (e) { report.failure = e.message; if (panel) { await panel.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); report.lastState = await panel.evaluate(async () => (await window.pet.software({ type: 'state' })).state).catch(() => undefined); } await save(); throw e; }
  finally { if (app) await app.close().catch(() => {}); await fs.rm(path.join(userDir, 'companion-secrets.json'), { force: true }); if (scriptedServer) { scriptedServer.closeAllConnections(); await new Promise(r => scriptedServer.close(r)); } }
  console.log('Completed:', path.join(run, 'report.json'));
})().catch(e => { console.error(e); process.exitCode = 1; });
