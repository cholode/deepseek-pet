// 真实 Electron + 生产模型适配器与表情搜索工具；HTTP 回传本机夹具，不使用真实账户。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/tool-continuation${packaged ? '-packaged' : ''}`);
  await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const checks = [], errors = [], requests = []; let held, app;
  const check = label => { checks.push(label); console.log('PASS', label); };
  const wait = async (fn, label) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`等待超时：${label}`); };
  const backend = http.createServer(async (req, res) => {
    try {
      const parts = []; for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
      const userIndex = body.messages.findLastIndex(m => m.role === 'user');
      const user = body.messages[userIndex].content;
      const results = body.messages.slice(userIndex + 1).filter(m => m.role === 'tool');
      const cancel = user === '连续执行后停止';
      if (cancel && results.length === 6) { held = res; return; }
      const continuing = (user === '完成连续工具任务' && results.length < 10) || cancel;
      let delta = { content: user === '完成连续工具任务' ? '十个工具步骤已全部完成。' : '停止后可以继续聊天。' };
      if (continuing) {
        assert.ok(body.tools.some(t => t.function.name === 'dafeiyu_sticker_search'));
        delta = { tool_calls: Array.from({ length: !cancel && results.length === 0 ? 5 : 1 }, (_, index) => ({ index, id: `call-${results.length + index}`, type: 'function', function: { name: 'dafeiyu_sticker_search', arguments: JSON.stringify({ query: '开心', limit: 1 }) } })) };
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: continuing ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error.message); res.writeHead(500).end(); }
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await app.firstWindow();
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋');
    const panel = app.windows().find(p => p.url().includes('page=panel'));
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.evaluate(async baseUrl => {
      const { state } = await window.pet.companion({ type: 'state' });
      const config = state.data.config;
      config.enabled = true; config.model.baseUrl = baseUrl; config.model.model = 'local-fixture';
      config.mood.enabled = false; config.memory.automatic = false; config.initiative.enabled = false; config.speech.enabled = false;
      const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw new Error(result.message);
      const stickers = await window.pet.stickers({ type: 'state' });
      const enabled = await window.pet.stickers({ type: 'configure', settings: { ...stickers.state.settings, enabled: true } }); if (!enabled.ok) throw new Error(enabled.message);
    }, `http://127.0.0.1:${backend.address().port}`);
    const send = async text => { await panel.getByLabel('对大肥鱼说').fill(text); await panel.getByRole('button', { name: '发送', exact: true }).click(); };
    const state = () => panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state);
    await send('完成连续工具任务');
    await wait(async () => { const s = await state(); return !s.busy && s.data.events.some(e => e.text === '十个工具步骤已全部完成。'); }, '连续工具完成');
    assert.equal(requests.length, 7);
    assert.equal(requests.at(-1).messages.filter(m => m.role === 'tool').length, 10);
    check('六轮十次真实表情搜索完整执行，首轮五个工具正常解析');
    await panel.screenshot({ path: path.join(folder, 'completed.png') });
    await send('连续执行后停止');
    await wait(() => Boolean(held), '取消前完成六次工具搜索');
    await panel.getByRole('button', { name: '停止思考与朗读', exact: true }).click();
    await wait(async () => !(await state()).busy && held.destroyed, '停止中断 HTTP 请求');
    assert.equal((await state()).data.events.filter(e => e.actor === 'pet').length, 1);
    check('超过旧轮数后停止按钮仍中断请求，不保存未完成回复');
    await send('你好');
    await wait(async () => { const s = await state(); return !s.busy && s.data.events.some(e => e.text === '停止后可以继续聊天。'); }, '停止后新会话');
    check('停止后可立即继续聊天');
    assert.deepEqual(errors, []); check('无渲染或协议错误');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, requests: requests.length, userDir, provider: '本机 SSE 夹具，未调用真实模型账户' }, null, 2));
  } finally {
    if (app) await app.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
