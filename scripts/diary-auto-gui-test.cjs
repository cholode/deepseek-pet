// 真实 Electron 主进程定时器；仅测试进程注入壁钟，不更改 Windows 时间或用户配置。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const folder = path.resolve('test-results/diary-auto'); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')), target = path.join(userDir, '日记');
  const checks = [], errors = [], calls = [];
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const time = (offset, clock) => new Date(`${day(offset)}T${clock}`).getTime();
  const wait = async fn => { const deadline = Date.now() + 30000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error('等待自动日记超时'); };
  const check = message => { checks.push(message); console.log('PASS', message); };
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString()); calls.push(input);
    const material = JSON.parse(input.messages[1].content);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: `${material.date}，我记得：${material.events.map(e => e.text).join('，')}。能一起聊这些，我很开心。` } }] }));
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel;
  const state = () => panel.evaluate(async () => (await window.pet.diary({ type: 'state' })).state);
  const setClock = async (value, ticking = false) => app.evaluate(({ powerMonitor }, { value, ticking }) => {
    globalThis.realDiaryNow ??= Date.now;
    const start = globalThis.realDiaryNow(); Date.now = () => value + (ticking ? globalThis.realDiaryNow() - start : 0);
    powerMonitor.emit('resume');
  }, { value, ticking });
  async function launch() {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')));
    panel = app.windows().find(p => p.url().includes('page=panel'));
    await wait(async () => (await panel.evaluate(() => window.pet.getDebug()))?.groups.length > 0);
  }
  async function openDiary() { await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '日记', exact: true }).click(); await panel.getByLabel('自动日记').waitFor(); }
  const file = offset => path.join(target, `大肥鱼日记-${day(offset)}.md`);
  try {
    // 提前创建隔离配置，避免在运行测试的真实时刻已过21点时写到项目根目录。
    await fs.writeFile(path.join(userDir, 'diary-settings.json'), JSON.stringify({ directory: target }));
    await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: day(0), nextDate: day(0), retryAt: time(0, '23:59:59') }));
    await launch(); const data = (await panel.evaluate(() => window.pet.companion({ type: 'state' }))).state.data;
    await app.close(); app = undefined;
    data.config.enabled = true; data.config.model.model = 'automatic-diary-fixture'; data.config.model.baseUrl = `http://127.0.0.1:${backend.address().port}/v1`;
    data.config.initiative.enabled = false; data.config.speech.enabled = false;
    data.events = [{ id: 'first', at: time(0, '20:00:00'), source: 'desktop', actor: 'user', conversationId: 'desktop', text: '今天把自动日记做好了' }, { id: 'third', at: time(2, '20:00:00'), source: 'desktop', actor: 'user', conversationId: 'desktop', text: '第三天聊了游戏' }];
    await fs.writeFile(path.join(userDir, 'companion.json'), JSON.stringify(data));
    // 给启动留出未来退避；设置地址会按产品规则清除退避，然后由测试时钟驱动到21点。
    await launch(); await setClock(time(0, '20:59:58'), true);
    await panel.evaluate(directory => window.pet.diary({ type: 'set-directory', directory }), target);
    assert.equal((await state()).automatic.lastWrittenDate, undefined);
    await wait(async () => (await state()).automatic.lastWrittenDate === day(0));
    assert.equal(calls.length, 1); assert.equal(calls[0].tools, undefined);
    assert.ok((await fs.readFile(file(0), 'utf8')).includes('今天把自动日记做好了'));
    check('未打开日记页，主进程真实定时器跨过21点后自动生成当天日记');
    await setClock(time(0, '22:00:00')); await new Promise(r => setTimeout(r, 300)); assert.equal(calls.length, 1);
    check('重复唤醒检查不会再次生成已完成日期');
    await app.close(); app = undefined; await launch();
    await setClock(time(3, '10:00:00'));
    await wait(async () => (await state()).automatic.lastWrittenDate === day(2));
    assert.equal((await state()).automatic.waitingDays, 0); assert.equal(calls.length, 2);
    const blank = await fs.readFile(file(1), 'utf8'), past = await fs.readFile(file(2), 'utf8');
    assert.ok(blank.includes('没有找到这一天保留下来的桌面对话')); assert.ok(past.includes('第三天聊了游戏')); assert.ok(past.includes('自动补记'));
    assert.equal(JSON.parse(calls[1].messages[1].content).mood, undefined);
    assert.equal(await fs.stat(file(3)).then(() => true, () => false), false);
    check('关闭程序漏掉两晚，下次启动逐日补齐；不提前写今天，不混用当前心情');
    check('无记录的漏写日保存如实说明，不为它额外调用模型');
    await openDiary(); await panel.getByLabel('自动日记').screenshot({ path: path.join(folder, 'automatic.png') });
    assert.ok((await panel.getByLabel('自动日记').innerText()).includes('21:00'));
    assert.equal(await panel.getByRole('article', { name: '日记正文' }).innerText().then(t => t.includes('dafeiyu-auto-diary')), false);
    check('页面显示固定21点与最近完成日期，内部去重标记不出现在正文预览');
    await app.close(); app = undefined; await launch(); await setClock(time(3, '10:00:00')); await new Promise(r => setTimeout(r, 300)); assert.equal(calls.length, 2);
    check('真实退出重启后保留进度，不重复补写');
    await app.evaluate(({ powerMonitor }, value) => { powerMonitor.emit('suspend'); Date.now = () => value; }, time(3, '22:00:00'));
    await new Promise(r => setTimeout(r, 250)); assert.equal((await state()).automatic.lastWrittenDate, day(2));
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    await wait(async () => (await state()).automatic.lastWrittenDate === day(3));
    assert.ok((await fs.readFile(file(3), 'utf8')).includes('自动日记'));
    check('休眠期间暂停，恢复后自动补上错过的21点任务');
    assert.deepEqual(errors, []); check('无渲染异常');
  } finally {
    if (app) await app.close(); backend.closeAllConnections(); await new Promise(r => backend.close(r));
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), executable: process.env.PET_TEST_EXECUTABLE || 'source', userDir, checks, errors }, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
