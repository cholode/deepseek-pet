// Windows 真窗口 + 真实插件子进程 + 隔离 Anki/模型协议夹具；不写用户的真实集合。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const folder = path.resolve('test-results/anki'); await fs.mkdir(folder, { recursive: true });
  const root = await fs.mkdtemp(path.join(folder, 'gui-')), userDir = path.join(root, 'user'), target = path.join(root, 'Anki 软件');
  await fs.mkdir(userDir); await fs.mkdir(target);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: day, nextDate: day, retryAt: 0 }));
  const checks = [], errors = [], actions = [], notes = [], models = new Map(), modelCalls = [];
  let ankiOffline = false;
  const card = { cardId: 7, note: 6, deckName: '大肥鱼::日语', type: 2, queue: 2, due: 20, interval: 3, reps: 2, lapses: 0, question: '<b>猫</b>', answer: 'ねこ · 猫' };
  const check = value => { checks.push(value); console.log('PASS', value); };
  const wait = async (predicate, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('等待超时'); };
  const backend = http.createServer((req, res) => { void (async () => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.action) {
      if (ankiOffline) { res.writeHead(503).end(); return; }
      const { action, params: p } = body; actions.push({ action, params: p }); let result = null;
      if (action === 'version') result = 6;
      if (action === 'getActiveProfile') result = 'GUI 学习用户';
      if (action === 'deckNames') result = ['大肥鱼::日语', '日本語::N5'];
      if (action === 'findCards') result = p.query.startsWith('nid:') ? [101] : [7];
      if (action === 'cardsInfo') result = [card];
      if (['guiDeckReview', 'guiReviewActive', 'guiShowQuestion', 'guiShowAnswer', 'guiStartCardTimer'].includes(action)) result = true;
      if (action === 'guiCurrentCard') result = { ...card, buttons: [1, 2, 3, 4], nextReviews: ['1 分钟', '5 分钟', '1 天', '4 天'] };
      if (action === 'getReviewsOfCards') result = {};
      if (action === 'modelNames') result = [...models.keys()];
      if (action === 'createModel') models.set(p.modelName, p.inOrderFields);
      if (action === 'modelFieldNames') result = models.get(p.modelName);
      if (action === 'createDeck') result = 1;
      if (action === 'findNotes') result = notes.filter(n => n.tags.includes(p.query.slice(4))).map(n => n.id);
      if (action === 'addNote') { result = 100 + notes.length; notes.push({ ...p.note, id: result }); }
      if (action === 'suspend') result = true;
      if (action === 'guiAnswerCard') { card.reps++; result = true; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result, error: null })); return;
    }
    modelCalls.push(body);
    const user = body.messages.filter(m => m.role === 'user').at(-1)?.content || '';
    const toolMessages = body.messages.filter(m => m.role === 'tool');
    const last = toolMessages.length ? JSON.parse(JSON.parse(toolMessages.at(-1).content).content[0].text) : undefined;
    const call = (name, args) => { const tool = body.tools.find(t => t.function.description.includes(`能力：${name}。`)); if (!tool) throw new Error(`missing ${name}`); return { content: null, tool_calls: [{ id: `call-${modelCalls.length}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] }; };
    let message;
    if (user.includes('打开 Anki')) message = !last ? call('anki_launch', {}) : { content: last.summary };
    else if (user.includes('开始练习')) message = !last ? call('anki_practice_start', { topic: '自我介绍' }) : { content: 'こんにちは！何を勉強していますか。' };
    else if (user.includes('私は学生')) message = !last ? call('anki_status', {}) : last.practice ? call('anki_practice_record', { sessionId: last.practice[0].sessionId, summary: '练习自我介绍', corrections: '', turns: [{ user: '私は学生です。', assistant: 'こんにちは！何を勉強していますか。' }], vocabulary: [{ expression: '学生', reading: 'がくせい', meaning: '学生', example: '私は学生です。' }] }) : { content: `记录已保存到 Anki，生词 ${last.vocabularyNoteIds.length} 个。` };
    else if (user.includes('复习卡片')) message = !last ? call('anki_review_next', {}) : { content: `请读出：${last.question}` };
    else if (user.includes('ねこ')) message = !last ? call('anki_status', {}) : last.review ? call('anki_review_reveal', { token: last.review[0].token }) : { content: `${last.answer}。请选择：1 重来，2 困难，3 良好，4 简单。` };
    else message = !last ? call('anki_status', {}) : last.review ? call('anki_review_grade', { token: last.review[0].token, ease: 3 }) : { content: '已将良好评分交给 Anki。' };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
  })().catch(e => { errors.push(e.message); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise(r => backend.listen(0, '127.0.0.1', r)); const port = backend.address().port;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel;
  async function launch() {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')));
    panel = app.windows().find(p => p.url().includes('page=panel')); await panel.getByRole('button', { name: '可操作软件', exact: true }).click();
    // 不发真实桌面通知；气泡仍使用实际窗口。
    await app.evaluate(({ Notification }) => { Notification.isSupported = () => false; });
  }
  const state = () => panel.evaluate(async () => (await window.pet.software({ type: 'state' })).state);
  const chat = async text => { const r = await panel.evaluate(text => window.pet.companion({ type: 'chat', text }), text); assert.equal(r.ok, true, r.message); return r; };
  try {
    await launch(); await panel.getByRole('button', { name: '安装 Anki 日语学习 插件', exact: true }).click(); await wait(async () => (await state()).plugins.length === 1);
    assert.equal(actions.length, 0); check('随附 Anki 插件可在小屋安装，安装不启动或写入 Anki');
    await panel.getByRole('button', { name: '＋ 添加软件', exact: true }).click(); await panel.getByLabel('软件名称', { exact: true }).fill('Anki 日语'); await panel.getByLabel('软件所在目录', { exact: true }).fill(target);
    await panel.getByRole('button', { name: '保存软件', exact: true }).click(); await wait(async () => (await state()).entries.length === 1 && !(await state()).busy);
    const entry = (await state()).entries[0], id = entry.id; assert.equal(entry.runtimePath, ''); assert.equal(entry.remindersEnabled, false);
    const dataFolder = path.join(userDir, 'software-data', id); await fs.mkdir(dataFolder, { recursive: true });
    const settings = { profile: 'GUI 学习用户', level: 'N5', dailyMinutes: 20, newCards: 5, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6], deck: '大肥鱼::日语', reviewDeck: '大肥鱼::日语', logDeck: '大肥鱼::学习记录', port };
    await fs.writeFile(path.join(dataFolder, 'study.json'), JSON.stringify({ version: 1, settings, sessions: [], reviews: [] }));
    await panel.getByRole('button', { name: '连接并读取能力', exact: true }).click(); await wait(async () => (await state()).entries[0].status === 'connected');
    assert.equal((await state()).entries[0].tools.length, 10); assert.equal(actions.length, 0);
    await panel.getByRole('button', { name: '选择全部能力', exact: true }).click(); await panel.getByRole('button', { name: '保存工具授权', exact: true }).click(); await wait(async () => (await state()).entries[0].grants.length === 10 && !(await state()).busy);
    check('内置 Node 运行时启动真实 MCP 子进程，10 项能力可授权；未配置时提醒默认关闭');
    await panel.getByRole('button', { name: '读取计划与学习状态', exact: true }).click(); await panel.getByLabel('日语程度', { exact: true }).waitFor(); await panel.getByLabel('日语程度', { exact: true }).selectOption('N4'); await panel.getByLabel('每天练习分钟', { exact: true }).fill('15'); await panel.getByRole('checkbox', { name: '周日', exact: true }).uncheck();
    await panel.getByRole('button', { name: '保存学习计划', exact: true }).click();
    await wait(async () => JSON.parse(await fs.readFile(path.join(dataFolder, 'study.json'), 'utf8')).settings.level === 'N4');
    const saved = JSON.parse(await fs.readFile(path.join(dataFolder, 'study.json'), 'utf8')).settings; assert.equal(saved.dailyMinutes, 15); assert.equal(saved.days.includes(0), false); assert.equal(notes.length, 0);
    await panel.getByRole('region', { name: '日语学习计划', exact: true }).scrollIntoViewIfNeeded(); await panel.screenshot({ path: path.join(folder, 'learning-plan.png') });
    check('小屋可读取连接状态、修改程度/分钟/学习日并保存计划，配置不建卡');
    await panel.evaluate(async url => { const r = await window.pet.companion({ type: 'state' }); const config = r.state.data.config; config.enabled = true; config.model.model = 'anki-fixture'; config.model.baseUrl = url; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw new Error(saved.message); }, `http://127.0.0.1:${port}/v1`);
    await chat('帮我打开 Anki');
    assert.ok((await state()).activities.some(a => a.tool === 'anki_launch' && a.status === 'completed'));
    assert.ok(modelCalls.some(c => c.messages.some(m => m.role === 'tool' && m.content.includes('Anki 已在运行'))));
    check('打开 Anki 的对话经授权工具和真实插件路由，接口已在线时不重复启动');
    await chat('开始练习日语，并用 Anki 记录'); await chat('私は学生です。');
    assert.equal(notes.length, 2); assert.ok(notes.some(n => n.fields.Transcript?.includes('私は学生です'))); assert.ok(actions.some(a => a.action === 'suspend')); assert.equal(actions.some(a => a.action === 'answerCards'), false);
    assert.ok(modelCalls.some(c => c.messages.some(m => m.role === 'tool' && m.content.includes('recorded'))));
    check('多轮日语对话经模型工具路由保存练习日志及生词，日志暂停且不伪造复习次数');
    await chat('复习卡片'); await chat('ねこ'); assert.equal(actions.some(a => a.action === 'answerCards'), false); await chat('3 良好');
    assert.equal(actions.filter(a => a.action === 'guiAnswerCard').length, 1); assert.equal(actions.find(a => a.action === 'guiAnswerCard').params.ease, 3); assert.equal(actions.some(a => a.action === 'answerCards'), false);
    check('取题→用户作答→揭示答案→用户评分的多轮聊天完成一次 Anki 评分');
    await panel.getByRole('checkbox', { name: '开启计划提醒', exact: true }).click(); await wait(async () => (await state()).entries[0].remindersEnabled);
    await app.close(); await launch(); const restored = (await state()).entries[0]; assert.equal(restored.remindersEnabled, true); assert.equal(restored.grants.length, 10);
    await panel.getByRole('button', { name: '读取计划与学习状态', exact: true }).click(); await panel.getByLabel('日语程度', { exact: true }).waitFor(); assert.equal(await panel.getByLabel('日语程度', { exact: true }).inputValue(), 'N4');
    check('重启恢复计划与授权，设置读取可按需重连插件');
    ankiOffline = true; await panel.getByRole('button', { name: '读取计划与学习状态', exact: true }).click(); await panel.getByText('AnkiConnect HTTP 503', { exact: true }).waitFor(); ankiOffline = false;
    check('Anki 离线时设置页明确显示错误，未误报记录成功');
    const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    await panel.getByLabel('提醒时间（电脑本地时间）', { exact: true }).fill(time); await panel.getByRole('button', { name: '保存学习计划', exact: true }).click();
    // 等待真实的一分钟调度，不篡改主进程定时器。
    await wait(async () => Boolean((await state()).entries[0].lastReminderKey), 75000);
    await wait(async () => { const bubble = app.windows().find(p => p.url().includes('page=speech-bubble')); return bubble && (await bubble.locator('body').innerText()).includes('该学日语啦'); });
    const bubble = app.windows().find(p => p.url().includes('page=speech-bubble')); await bubble.screenshot({ path: path.join(folder, 'study-reminder.png') });
    check('真实定时轮询在计划时间显示大肥鱼学习气泡，不需要模型生成提醒');
    await panel.getByRole('checkbox', { name: '开启计划提醒', exact: true }).click(); await panel.getByRole('button', { name: '停止并停用全部软件', exact: true }).click(); await wait(async () => !(await state()).entries[0].enabled); check('关闭提醒和全部停用可生效');
    await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')); if (w.isMaximized()) await new Promise(resolve => { w.once('unmaximize', resolve); w.unmaximize(); }); w.setSize(800, 620); });
    await wait(async () => await panel.evaluate(() => innerWidth <= 800 && innerHeight <= 620)); await panel.screenshot({ path: path.join(folder, 'small-window.png') });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); check('最小窗口布局无横向溢出');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(folder, process.env.PET_TEST_EXECUTABLE ? 'packaged-gui-report.json' : 'gui-report.json'), JSON.stringify({ checks, errors, noteCount: notes.length, modelCalls: modelCalls.length, simulatedAnki: true, realWindows: true, realMcpProcess: true }, null, 2));
  } catch (e) {
    if (panel) { console.error((await panel.locator('body').innerText()).slice(-6000)); await panel.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => {}); }
    throw e;
  } finally { if (app) await app.close().catch(() => {}); backend.closeAllConnections(); await new Promise(r => backend.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
