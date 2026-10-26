// 真实 Electron 窗口 + 本机模拟模型；测试数据隔离，不读取用户凭证或连接外部账号。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const folder = path.resolve('test-results/companion'); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const checks = []; const errors = []; const calls = [];
  const check = label => { checks.push(label); console.log('PASS', label); };
  // IPC 返回 Promise，显式等待后再判断，避免把 Promise 对象本身当作条件满足。
  const wait = async predicate => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('状态等待超时');
  };
  const backend = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString()); calls.push(payload);
      const appraisal = payload.messages[0].content.includes('事件评价器');
      const last = payload.messages.at(-1).content;
      if (!appraisal && last.includes('延迟')) return;
      const content = appraisal ? JSON.stringify({ emotion: 'happy', delta: 3, confidence: .95, reason: '用户分享游戏偏好', memories: [{ text: '用户喜欢星露谷', evidence: '喜欢星露谷', kind: 'preference', factKey: '用户.游戏' }] }) : '记住啦，你喜欢星露谷。下次可以接着聊我们的农场！';
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const start = async () => {
    const launch = process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] };
    app = await electron.launch({ ...launch, env });
    await app.firstWindow();
    const end = Date.now() + 30000;
    while ((!app.windows().some(p => p.url().includes('page=panel')) || !app.windows().some(p => p.url().includes('page=pet'))) && Date.now() < end) await new Promise(r => setTimeout(r, 100));
    const panel = app.windows().find(p => p.url().includes('page=panel'));
    const pet = app.windows().find(p => p.url().includes('page=pet'));
    for (const win of app.windows()) win.on('pageerror', e => errors.push(e.message));
    await pet.waitForSelector('canvas', { timeout: 30000 });
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.getByRole('button', { name: '陪伴设置', exact: true }).waitFor();
    await panel.waitForFunction(() => document.querySelector('nav .count')?.textContent === '33');
    return { panel, pet };
  };
  try {
    let { panel, pet } = await start();
    const request = (page, value) => page.evaluate(v => window.pet.companion(v), value);
    const state = async page => (await request(page, { type: 'state' })).state;
    assert.equal((await state(panel)).ready, false); assert.equal(calls.length, 0); check('默认关闭智能陪伴，无模型请求');
    // 通过界面完成首次配置，包含 Windows safeStorage 密钥加密。
    await panel.getByRole('button', { name: '陪伴设置', exact: true }).click();
    await panel.getByLabel('启用智能陪伴', { exact: true }).check();
    await panel.getByLabel('模型服务地址', { exact: true }).fill(`http://127.0.0.1:${backend.address().port}/v1`);
    await panel.getByLabel('模型名称', { exact: true }).fill('local-fixture');
    await panel.getByLabel('模型 API Key', { exact: true }).fill('gui-fixture-secret');
    await panel.getByRole('button', { name: '保存陪伴设置', exact: true }).click();
    await panel.waitForFunction(() => document.body.textContent.includes('陪伴设置已保存'));
    assert.equal((await state(panel)).hasSecrets.model, true);
    assert.equal((await fs.readFile(path.join(userDir, 'companion-secrets.json'), 'utf8')).includes('gui-fixture-secret'), false); check('界面可配置，密钥以系统加密形式保存');
    await panel.evaluate(async () => { const b = await window.pet.bootstrap(); await window.pet.saveSettings({ ...b.settings, paused: true }); await window.pet.panelRequest({ type: 'command', command: { protocolVersion: 1, type: 'stop_current', commandId: crypto.randomUUID() } }); });
    await panel.getByRole('button', { name: '和她聊天', exact: true }).click();
    await panel.getByLabel('对大肥鱼说').fill('我喜欢星露谷'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await wait(async () => { const s = await state(panel); return !s.busy && s.data.events.some(e => e.actor === 'pet'); });
    const after = await state(panel); assert.equal(after.data.memories[0].text, '用户喜欢星露谷'); assert.equal(after.data.mood.timeline.length, 1);
    await wait(() => app.windows().some(p => p.url().includes('page=speech-bubble')));
    await app.windows().find(p => p.url().includes('page=speech-bubble')).waitForSelector('.speech-bubble');
    await wait(() => panel.evaluate(async () => (await window.pet.getDebug())?.events.some(e => e.type === 'action_lifecycle' && e.payload.source === 'ai')));
    check('聊天、自动记忆、心情、气泡及现有 AI 动作通道联动');
    await panel.screenshot({ path: path.join(folder, 'chat.png') }); await pet.screenshot({ path: path.join(folder, 'pet.png'), omitBackground: true });
    await panel.getByRole('button', { name: '共同记忆', exact: true }).click(); await panel.screenshot({ path: path.join(folder, 'memory.png') });
    // 取消真实 HTTP 等待，随后不能再出现迟到回复。
    await panel.getByRole('button', { name: '和她聊天', exact: true }).click();
    await panel.getByLabel('对大肥鱼说').fill('延迟测试'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('.companion-tabs')?.textContent.includes('正在想'));
    await panel.getByRole('button', { name: '停止思考与朗读', exact: true }).click();
    await panel.waitForFunction(() => !document.querySelector('.companion-tabs')?.textContent.includes('正在想'));
    assert.equal((await state(panel)).data.events.filter(e => e.actor === 'pet').length, 1); check('停止中断模型请求并清空展示');
    await app.close(); app = undefined;
    ({ panel, pet } = await start()); const restored = await state(panel);
    assert.equal(restored.data.memories.length, 1); assert.equal(restored.hasSecrets.model, true); check('重启恢复记忆、配置和加密密钥');
    await request(panel, { type: 'forget', id: restored.data.memories[0].id });
    const forgotten = await state(panel); assert.equal(forgotten.data.memories.length, 0); assert.equal(forgotten.data.events.length, 0);
    assert.equal((await fs.readFile(path.join(userDir, 'companion.json'), 'utf8')).includes('用户喜欢星露谷'), false); check('忘记实际移除内容与聊天上下文');
    await panel.getByRole('button', { name: '陪伴设置', exact: true }).click();
    await panel.getByLabel('启用智能陪伴', { exact: true }).uncheck();
    await panel.getByRole('button', { name: '保存陪伴设置', exact: true }).click();
    await wait(() => panel.evaluate(async () => (await window.pet.getDebug())?.snapshot.mode === 'normal')); check('关闭智能陪伴回到普通模式');
    await panel.getByRole('button', { name: '陪伴设置', exact: true }).click();
    await panel.screenshot({ path: path.join(folder, 'settings.png'), fullPage: true });
    assert.deepEqual(errors, []); check('无渲染异常');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors, provider: '本机模拟模型，未使用真实账号', userDir }, null, 2));
  } finally {
    if (app) await app.close(); backend.closeAllConnections(); await new Promise(r => backend.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
