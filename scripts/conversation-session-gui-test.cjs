// 真实 Electron / HTTP 请求与磁盘持久化；只使用独立测试目录和本机 SSE 夹具。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/conversation-session${packaged ? '-packaged' : ''}`);
  await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const today = new Date(); const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(userDir, 'diary-settings.json'), JSON.stringify({ directory: path.join(userDir, 'diary') }));
  await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: localDay, nextDate: localDay, retryAt: Date.now() + 2 * 86400000 }));
  const checks = [], errors = [], requests = []; let app, panel, held;
  const check = label => { checks.push(label); console.log('PASS', label); };
  const wait = async (fn, label) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`等待超时：${label}`); };
  const backend = http.createServer(async (req, res) => {
    try {
      const parts = []; for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
      const user = body.messages.findLast(m => m.role === 'user').content;
      if (user === '等待中的操作') { held = res; return; }
      const content = `新的回复：${user}`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error.message); res.writeHead(500).end(); }
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = async () => {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋');
    panel = app.windows().find(p => p.url().includes('page=panel'));
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
  };
  const state = () => panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state);
  const send = async text => {
    await panel.getByLabel('对大肥鱼说').fill(text); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await wait(async () => { const s = await state(); return !s.busy && s.data.events.some(e => e.text === `新的回复：${text}`); }, text);
  };
  const messages = () => requests.at(-1).messages.filter(m => m.role !== 'system').map(m => m.content);
  const seed = async age => {
    await app.close(); app = undefined;
    const file = path.join(userDir, 'companion.json'); const data = JSON.parse(await fs.readFile(file, 'utf8'));
    const at = Date.now() - age;
    data.events = [
      { id: 'old-question', at, actor: 'user', source: 'desktop', conversationId: 'desktop', text: '继续旧的单词练习' },
      { id: 'old-answer', at: Date.now() - 1000, actor: 'pet', source: 'desktop', conversationId: 'desktop', causeId: 'old-question', text: '旧练习：给上张卡评分' }
    ];
    data.processedIds = ['old-question'];
    await fs.writeFile(file, JSON.stringify(data, null, 2)); await launch();
  };
  try {
    await launch();
    await panel.evaluate(async baseUrl => {
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.baseUrl = baseUrl; config.model.model = 'local-fixture';
      config.mood.enabled = false; config.memory.automatic = false; config.initiative.enabled = false; config.speech.enabled = false;
      for (const request of [
        { type: 'configure', config },
        { type: 'remember', text: '用户喜欢日语', kind: 'preference', factKey: 'user.language', scope: 'private', pinned: true },
        { type: 'goal', text: '每天练习日语', dueAt: Date.now() + 86400000 }
      ]) { const r = await window.pet.companion(request); if (!r.ok) throw new Error(r.message); }
    }, `http://127.0.0.1:${backend.address().port}`);

    await seed(86400000); await send('早上好');
    assert.deepEqual(messages(), ['早上好']); assert.ok((await state()).notice.includes('新一段对话'));
    await panel.getByText('旧练习：给上张卡评分', { exact: true }).waitFor();
    check('跨天后实际模型请求只含新消息，旧聊天仍可查看并提示新对话');
    const retained = await state(); assert.equal(retained.data.memories.length, 1); assert.equal(retained.data.goals.length, 1);
    assert.ok(requests.at(-1).messages.some(m => m.role === 'system' && m.content.includes('每天练习日语')));
    assert.ok(requests.at(-1).messages.some(m => m.role === 'system' && m.content.includes('用户喜欢日语')));
    check('长期偏好和学习计划保留为背景，不清空历史或学习资料');

    await seed(31 * 60000); await send('聊聊今天');
    assert.deepEqual(messages(), ['聊聊今天']);
    const firstId = (await state()).data.events.find(e => e.text === '聊聊今天').sessionId;
    check('闲置超过 30 分钟另起对话，刚收到的旧回复不延长会话');
    await send('接着聊这件事');
    assert.deepEqual(messages(), ['聊聊今天', '新的回复：聊聊今天', '接着聊这件事']);
    assert.equal((await state()).data.events.find(e => e.text === '接着聊这件事').sessionId, firstId);
    check('短时间连续聊天保留本段上下文，不带入已结束的单词练习');
    await panel.screenshot({ path: path.join(folder, 'new-conversation.png'), fullPage: true });

    await panel.getByLabel('对大肥鱼说').fill('等待中的操作'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await wait(() => Boolean(held), '请求保持等待');
    // 仅改测试进程壁钟，让真实后台定时器检查到过期；不修改 Windows 系统时间。
    await app.evaluate(() => { const original = Date.now; Date.now = () => original() + 31 * 60000; });
    await wait(async () => !(await state()).busy && held.destroyed, '真实定时器取消过期请求');
    assert.equal((await state()).data.events.filter(e => e.actor === 'pet').length, 3);
    check('用户停止发消息后后台自动结束会话，中断真实 HTTP 等待且不保存迟到回复');

    await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    assert.equal(await panel.getByLabel('对话空闲结束时间').inputValue(), '30');
    await panel.getByLabel('对话空闲结束时间').fill('60'); await panel.getByRole('button', { name: '保存对话设置', exact: true }).click();
    await wait(async () => (await panel.evaluate(async () => (await window.pet.voice({ type: 'state' })).state)).config.session.idleMinutes === 60, '保存间隔');
    await panel.screenshot({ path: path.join(folder, 'conversation-settings.png'), fullPage: true });
    check('对话设置可调整结束间隔，默认 30 分钟且保存为 60 分钟');

    await app.close(); app = undefined; await launch();
    await send('重新问候'); assert.deepEqual(messages(), ['重新问候']);
    assert.notEqual((await state()).data.events.find(e => e.text === '重新问候').sessionId, firstId);
    check('重启和调长间隔后，已经结束的对话不会恢复为当前任务');
    await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    assert.equal(await panel.getByLabel('对话空闲结束时间').inputValue(), '60'); check('结束间隔重启后保留');
    assert.deepEqual(errors, []); check('无渲染或协议错误');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, requests: requests.length, userDir, provider: '本机 SSE 夹具；没有使用用户配置或真实模型账号' }, null, 2));
  } finally { if (app) await app.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
