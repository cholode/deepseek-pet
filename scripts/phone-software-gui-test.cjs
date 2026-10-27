// 隔离配置 + 真实 Electron/MCP 管线；模型/工具后端与鼠标采样为夹具，不操作用户软件。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const folder = path.resolve(process.env.PET_TEST_RESULTS || 'test-results/phone-software');
  await fs.mkdir(folder, { recursive: true });
  const root = await fs.mkdtemp(path.join(folder, 'run-')), userDir = path.join(root, 'user'), download = path.join(root, 'plugin');
  await fs.mkdir(userDir); await fs.mkdir(download);
  const checks = [], errors = [], gates = []; let modelGate, toolGate, failTool = false;
  function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); gates.push(release); return { promise, release }; }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { const end = Date.now() + 25000; while (Date.now() < end) { if (await predicate()) return; await delay(70); } throw Error('等待条件超时'); };
  const check = text => { checks.push(text); console.log('PASS', text); };
  const backend = http.createServer((req, res) => { void (async () => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === '/mcp') {
      const server = new McpServer({ name: 'phone-context-fixture', version: '1' });
      server.registerTool('wait_for_result', { description: '等待协议结果，不操作软件', inputSchema: {} }, async () => {
        await toolGate?.promise;
        return { isError: failTool, content: [{ type: 'text', text: failTool ? 'fixture failure' : 'done' }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport); res.on('close', () => { void server.close(); }); await transport.handleRequest(req, res, body);
    } else {
      await modelGate?.promise;
      const lastUser = body.messages.findLastIndex(message => message.role === 'user');
      const hasResult = body.messages.slice(lastUser + 1).some(message => message.role === 'tool');
      const tool = body.tools?.find(item => item.function.name.startsWith('sw_'));
      const message = hasResult ? { content: '协议执行结束。' } : { content: null, tool_calls: [{ id: 'phone-context-call', type: 'function', function: { name: tool.function.name, arguments: '{}' } }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
    }
  })().catch(error => { errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  await fs.writeFile(path.join(download, 'software-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'test.phone-context', name: '动作情境测试', version: '1.0.0', description: '仅用于协议测试', transport: { type: 'streamable-http', defaultUrl: `${base}/mcp` } }));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await app.firstWindow(); await wait(() => app.windows().some(page => page.url().includes('page=panel')));
    const panel = app.windows().find(page => page.url().includes('page=panel'));
    const pet = app.windows().find(page => page.url().includes('page=pet'));
    const state = () => panel.evaluate(() => window.pet.getDebug());
    const desktop = () => panel.evaluate(async () => (await window.pet.bootstrap()).desktop);
    const phone = async () => Boolean((await state())?.snapshot.currentAction?.groupId.includes(':play_phone'));
    await wait(async () => (await state())?.groups.length === 33);
    await app.evaluate(({ screen, ipcMain }) => { globalThis.testCursor = { x: -50000, y: -50000 }; screen.getCursorScreenPoint = () => globalThis.testCursor; ipcMain.on('hit-regions', (_event, regions) => { globalThis.testHitRegions = regions; }); });
    const hoverPet = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('page=pet')); const bounds = win.getBounds(), region = globalThis.testHitRegions[0]; globalThis.testCursor = { x: bounds.x + region.x + region.width / 2, y: bounds.y + region.y + region.height / 2 }; });
    await panel.evaluate(async () => {
      const boot = await window.pet.bootstrap(); const debug = await window.pet.getDebug();
      boot.settings.intervalMinMs = 1000; boot.settings.intervalMaxMs = 1000;
      boot.settings.overrides = Object.fromEntries(debug.groups.map(group => [group.groupId, { eligible: Boolean(group.conditions.requiresSoftwareOperation), cooldownMs: 0 }]));
      await window.pet.saveSettings(boot.settings);
    });
    await panel.getByRole('button', { name: /动作组/ }).first().click();
    await panel.getByPlaceholder('搜索动作、标签或动作包').fill('玩手机');
    const cards = panel.locator('.group-card'); assert.equal(await cards.count(), 12);
    assert.equal(await panel.locator('.preview:disabled').count(), 12);
    assert.equal(await panel.getByText('仅操作软件且无互动时', { exact: true }).count(), 12);
    await panel.screenshot({ path: path.join(folder, 'context-options.png') });
    const rejected = await panel.evaluate(() => window.pet.panelRequest({ type: 'command', command: { protocolVersion: 1, commandId: 'blocked-phone', type: 'play_group', groupId: 'builtin.deepblue:play_phone' } }));
    assert.equal(rejected.errorCode, 'CONTEXT_REQUIRED'); check('全部 12 种动作显示情境限制，手动命令无法绕过');
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, download);
    const sw = async request => { const result = await panel.evaluate(request => window.pet.software(request), request); assert.equal(result.ok, true, result.message); return result; };
    await sw({ type: 'import-plugin' });
    const saved = await sw({ type: 'save', software: { name: '情境测试目标', directory: root, pluginId: 'test.phone-context', url: `${base}/mcp`, runtimePath: '' } });
    const id = saved.state.entries[0].id;
    await sw({ type: 'connect', id }); await sw({ type: 'grant', id, tools: ['wait_for_result'] });
    await delay(6000); assert.equal(await phone(), false); assert.equal(Boolean((await desktop()).softwareOperating), false);
    check('开启所有手机随机选项、插件已连接授权，普通空闲仍不玩手机');
    await panel.evaluate(async url => {
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.baseUrl = url; config.model.model = 'context-fixture';
      config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.mcp.enabled = false;
      const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw Error(saved.message);
    }, `${base}/v1`);
    const begin = async () => panel.evaluate(() => { window.testChatDone = false; void window.pet.companion({ type: 'chat', text: '调用测试软件等待结果' }).then(result => { window.testChatResult = result; window.testChatDone = true; }); });
    const finish = async () => wait(() => panel.evaluate(() => window.testChatDone));
    await hoverPet();
    await wait(async () => (await desktop()).chatting);
    modelGate = gate(); toolGate = gate(); await begin();
    await app.evaluate(() => { globalThis.testCursor = { x: -50000, y: -50000 }; });
    await delay(6000); assert.equal(await phone(), false); assert.equal(Boolean((await desktop()).softwareOperating), false);
    check('模型思考和聊天窗等待不会误触发手机动作');
    modelGate.release(); await wait(phone); assert.equal((await desktop()).softwareOperating, true); assert.equal((await desktop()).chatting, true);
    await pet.screenshot({ path: path.join(folder, 'operating.png') }); check('实际 MCP 工具执行期间，无互动时自动玩手机，等待中的聊天窗不阻挡');
    await panel.getByPlaceholder('搜索动作、标签或动作包').press('A');
    await wait(async () => !(await phone())); await delay(1000); assert.equal(await phone(), false);
    check('小屋键盘输入立即收起手机');
    await wait(phone);
    await hoverPet();
    await wait(async () => (await desktop()).pointerNear); await wait(async () => !(await phone()));
    check('鼠标靠近大肥鱼立即收起手机');
    await app.evaluate(() => { globalThis.testCursor = { x: -50000, y: -50000 }; });
    await delay(1000); assert.equal(await phone(), false); await wait(phone);
    toolGate.release(); await finish(); await wait(async () => !(await phone())); assert.equal((await desktop()).softwareOperating, false);
    check('鼠标离开后重新等待空闲门槛，工具完成即收起');
    toolGate = gate(); await begin(); await wait(phone);
    const quickChat = app.windows().find(page => page.url().includes('page=quick-chat'));
    await quickChat.locator('textarea').press('B'); await wait(async () => !(await phone()));
    assert.equal((await desktop()).softwareOperating, true); check('聊天框输入也立即让手机动作让位');
    await wait(phone);
    await panel.evaluate(() => window.pet.companion({ type: 'cancel' })); await wait(async () => !(await phone()));
    assert.equal((await desktop()).softwareOperating, false); toolGate.release(); await finish();
    check('取消调用立即收起，迟到结果不能重启手机动作');
    toolGate = gate(); failTool = true; await begin(); await wait(phone); toolGate.release(); await finish();
    await wait(async () => !(await phone())); assert.equal((await desktop()).softwareOperating, false);
    const final = await sw({ type: 'state' }); assert.equal(final.state.activities.at(-1).status, 'failed');
    check('真实 MCP 错误结果清除操作状态并恢复站姿');
    assert.deepEqual(errors, []); assert.deepEqual((await state()).errors, []); check('无渲染或动作运行错误');
  } finally {
    if (app) {
      const panel = app.windows().find(page => page.url().includes('page=panel'));
      if (panel) await fs.writeFile(path.join(folder, 'last-state.json'), JSON.stringify(await panel.evaluate(async () => ({ desktop: (await window.pet.bootstrap()).desktop, debug: await window.pet.getDebug(), chatDone: window.testChatDone, chatResult: window.testChatResult?.message, companionError: (await window.pet.companion({ type: 'state' })).state.error })), null, 2)).catch(() => {});
    }
    gates.forEach(release => release()); if (app) await app.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), executable: process.env.PET_TEST_EXECUTABLE || 'source', checks, errors, userDir }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
