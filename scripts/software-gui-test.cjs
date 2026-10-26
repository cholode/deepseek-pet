// 仅使用隔离配置、本机协议夹具和零能力模板，不控制任何具体软件。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { z } = await import('zod');
  const folder = path.resolve('test-results/software'); await fs.mkdir(folder, { recursive: true });
  const root = await fs.mkdtemp(path.join(folder, 'run-')), userDir = path.join(root, 'user'), target = path.join(root, '测试 软件目录'), download = path.join(root, 'download');
  await fs.mkdir(userDir); await fs.mkdir(target); await fs.mkdir(download);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: day, nextDate: day, retryAt: 0 }));
  const checks = [], errors = [], calls = [], modelCalls = [];
  const check = value => { checks.push(value); console.log('PASS', value); };
  const wait = async predicate => { const end = Date.now() + 30000; while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error('等待超时'); };
  const backend = http.createServer((req, res) => { void (async () => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === '/mcp') {
      const server = new McpServer({ name: 'gui-protocol-fixture', version: '1' });
      server.registerTool('echo', { description: '仅回显测试文字，不操作软件', inputSchema: { text: z.string() } }, async (args, extra) => {
        calls.push({ args, meta: extra._meta, token: req.headers.authorization }); return { content: [{ type: 'text', text: `协议收到：${args.text}` }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport); res.on('close', () => { void server.close(); }); await transport.handleRequest(req, res, body);
    } else {
      modelCalls.push(body);
      const tool = body.tools?.find(t => t.function.name.startsWith('sw_'));
      const message = body.messages.some(m => m.role === 'tool') ? { content: '插件框架验证完成，收到真实回显。' } : tool ? { content: null, tool_calls: [{ id: 'gui-call', type: 'function', function: { name: tool.function.name, arguments: '{"text":"hello-framework"}' } }] } : { content: '当前没有授权的软件能力。' };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
    }
  })().catch(e => { errors.push(`backend: ${e.message}`); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${backend.address().port}`;
  await fs.writeFile(path.join(download, 'software-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'test.gui-plugin', name: '协议回显插件', version: '1.0.0', description: 'GUI 框架验收夹具，不控制实际软件。', transport: { type: 'streamable-http', defaultUrl: `${baseUrl}/mcp` } }));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel;
  async function launch() {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')));
    panel = app.windows().find(p => p.url().includes('page=panel'));
    await wait(async () => (await panel.evaluate(() => window.pet.getDebug()))?.groups.length > 0);
    await panel.getByRole('button', { name: '可操作软件', exact: true }).click();
    await panel.getByRole('button', { name: '导入软件插件', exact: true }).waitFor();
  }
  const state = () => panel.evaluate(async () => (await window.pet.software({ type: 'state' })).state);
  async function choose(directory) { await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async (...args) => { globalThis.softwareDialog = args.at(-1); return value ? { canceled: false, filePaths: [value] } : { canceled: true, filePaths: [] }; }; }, directory); }
  try {
    await launch(); assert.equal((await state()).plugins.length, 0); assert.equal((await state()).entries.length, 0);
    await panel.getByText('还没有关联软件', { exact: true }).waitFor();
    await panel.screenshot({ path: path.join(folder, 'empty.png') }); check('侧栏有可操作软件，首次空状态没有预装具体软件能力');
    await choose(undefined); await panel.getByRole('button', { name: '导入软件插件', exact: true }).click(); assert.equal((await state()).plugins.length, 0);
    await choose(download); await panel.getByRole('button', { name: '导入软件插件', exact: true }).click();
    await wait(async () => (await state()).plugins.length === 1 && !(await state()).busy);
    assert.ok((await app.evaluate(() => globalThis.softwareDialog)).properties.includes('openDirectory')); assert.equal(calls.length, 0);
    check('原生导入接口可取消，插件目录复制成功且导入不执行工具');
    await panel.getByRole('button', { name: '＋ 添加软件', exact: true }).click(); await panel.getByLabel('软件名称', { exact: true }).fill('框架验收目标');
    await choose(target); await panel.getByRole('button', { name: '定位目录', exact: true }).click(); await wait(async () => await panel.getByLabel('软件所在目录', { exact: true }).inputValue() === target);
    await panel.getByLabel('插件访问令牌（可选）', { exact: true }).fill('gui-test-plugin-token');
    await panel.getByRole('button', { name: '保存软件', exact: true }).click(); await wait(async () => (await state()).entries.length === 1 && !(await state()).busy);
    let entry = (await state()).entries[0]; const id = entry.id;
    assert.equal(entry.directory, target); assert.equal(entry.enabled, false); assert.deepEqual(entry.grants, []); assert.equal(entry.hasToken, true);
    assert.equal((await fs.readFile(path.join(userDir, 'software.json'), 'utf8')).includes('gui-test-plugin-token'), false);
    assert.equal(JSON.stringify(await state()).includes('sealedToken'), false); check('中文空格软件目录可保存，令牌使用 Windows 系统加密且不返回界面');
    await panel.getByRole('button', { name: '连接并读取能力', exact: true }).click(); await wait(async () => (await state()).entries[0].status === 'connected' && !(await state()).busy);
    entry = (await state()).entries[0]; assert.equal(entry.tools[0].name, 'echo'); assert.deepEqual(entry.grants, []);
    await panel.getByRole('checkbox', { name: /echo/ }).check(); await panel.getByRole('button', { name: '保存工具授权', exact: true }).click();
    await wait(async () => (await state()).entries[0].grants.length === 1 && !(await state()).busy);
    await panel.getByRole('article', { name: '软件 框架验收目标', exact: true }).scrollIntoViewIfNeeded();
    await panel.screenshot({ path: path.join(folder, 'connected.png') }); check('真实 MCP 连接读取能力，工具逐项授权成功');
    await panel.evaluate(async url => {
      const r = await window.pet.companion({ type: 'state' }); const config = r.state.data.config;
      config.enabled = true; config.model.model = 'framework-fixture'; config.model.baseUrl = url;
      config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.mcp.enabled = false;
      const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw new Error(saved.message);
    }, `${baseUrl}/v1`);
    const chat = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '执行一次协议回显测试' })); assert.equal(chat.ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].meta['dafeiyu/target'].softwareDirectory, target); assert.equal(calls[0].token, 'Bearer gui-test-plugin-token');
    assert.ok(modelCalls.at(-1).messages.some(m => m.role === 'tool' && m.content.includes('hello-framework')));
    assert.equal((await state()).activities.at(-1).status, 'completed'); check('关闭旧 MCP 开关仍可经模型调用软件插件，实际工具结果返回模型并记录状态');
    const pet = app.windows().find(p => p.url().includes('page=pet'));
    assert.equal(await pet.evaluate(async () => { try { await window.pet.software({ type: 'state' }); return false; } catch (e) { return String(e).includes('IPC_FORBIDDEN'); } }), true);
    assert.equal(await panel.evaluate(async () => { try { await window.pet.software({ type: 'invoke', command: 'no' }); return false; } catch { return true; } }), true);
    check('人物窗口不能管理插件，IPC 不暴露任意工具执行入口');
    await app.close(); app = undefined; await launch();
    entry = (await state()).entries[0]; assert.equal(entry.id, id); assert.equal(entry.status, 'disconnected'); assert.equal(entry.grants.length, 1); assert.equal(entry.hasToken, true);
    const afterRestart = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '重启后再次验证' })); assert.equal(afterRestart.ok, true); assert.equal(calls.length, 2);
    check('真实重启保留软件与授权，在聊天需要时重新连接并成功使用加密凭证');
    await panel.getByRole('button', { name: '停止并停用全部软件', exact: true }).click(); await wait(async () => !(await state()).entries[0].enabled && !(await state()).busy);
    const stopped = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '停用后的验证' })); assert.equal(stopped.ok, true); assert.equal(calls.length, 2);
    check('停止全部后连接关闭，后续聊天不再获得软件工具');
    await choose(path.resolve('examples/software-plugin-template')); await panel.getByRole('button', { name: '导入软件插件', exact: true }).click(); await wait(async () => (await state()).plugins.length === 2 && !(await state()).busy);
    await panel.getByRole('button', { name: '＋ 添加软件', exact: true }).click(); await panel.getByLabel('软件名称', { exact: true }).fill('空能力骨架'); await panel.getByLabel('软件所在目录', { exact: true }).fill(target);
    await panel.getByLabel('关联插件', { exact: true }).selectOption('example.software-adapter'); await choose(process.execPath); await panel.getByRole('button', { name: '选择运行时', exact: true }).click();
    await wait(async () => await panel.getByLabel('运行时可执行文件', { exact: true }).inputValue() === process.execPath);
    assert.ok((await app.evaluate(() => globalThis.softwareDialog)).properties.includes('openFile'));
    await panel.getByRole('button', { name: '保存软件', exact: true }).click(); await wait(async () => (await state()).entries.length === 2 && !(await state()).busy);
    const emptyCard = panel.getByRole('article', { name: '软件 空能力骨架', exact: true });
    await emptyCard.getByRole('button', { name: '连接并读取能力', exact: true }).click(); await wait(async () => (await state()).entries.find(e => e.name === '空能力骨架').status === 'connected');
    assert.equal((await state()).entries.find(e => e.name === '空能力骨架').tools.length, 0); check('Node.js 本地插件可通过运行时选择器接入，空模板如实显示零能力');
    await panel.getByRole('tab', { name: /插件库/ }).click(); await panel.screenshot({ path: path.join(folder, 'plugins.png') });
    await panel.locator('.software-plugin-card').filter({ hasText: '协议回显插件' }).getByRole('button', { name: '移除插件', exact: true }).click();
    await wait(async () => (await state()).plugins.length === 1 && !(await state()).busy); entry = (await state()).entries.find(e => e.id === id);
    assert.equal(entry.enabled, false); assert.deepEqual(entry.grants, []); assert.deepEqual(entry.tools, []); assert.equal((await fs.stat(target)).isDirectory(), true);
    check('移除插件清空关联授权，保留用户软件目录');
    await app.evaluate(async ({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')); if (win.isMaximized()) await new Promise(resolve => { win.once('unmaximize', resolve); win.unmaximize(); }); win.setSize(800, 620); });
    await wait(async () => await panel.evaluate(() => window.innerWidth <= 800 && window.innerHeight <= 620));
    await panel.getByRole('tab', { name: /软件列表/ }).click(); await panel.screenshot({ path: path.join(folder, 'compact.png') });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); check('最小窗口宽度没有横向溢出');
    assert.deepEqual(errors, []); check('全过程无渲染异常');
  } finally {
    if (app) await app.close(); backend.closeAllConnections(); await new Promise(r => backend.close(r));
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), executable: process.env.PET_TEST_EXECUTABLE || 'source', userDir, checks, errors }, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
