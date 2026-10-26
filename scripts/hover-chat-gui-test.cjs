// 真实 Electron + 本地 SSE；仅在测试进程注入光标坐标，不操作用户鼠标或真实模型账户。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const sharp = require('sharp');

(async () => {
  const folder = path.resolve('test-results/hover-chat'); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const checks = [], errors = [], calls = []; let stream;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label = '') => { const until = Date.now() + 30000; while (Date.now() < until) { if (await predicate()) return; await delay(50); } throw new Error(`等待超时：${label}`); };
  const check = text => { checks.push(text); console.log('PASS', text); };
  const push = (text, done = false) => {
    const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: done ? 'stop' : null }] })}\r\n\r\n`);
    stream.write(bytes.subarray(0, bytes.length - 9)); stream.write(bytes.subarray(bytes.length - 9));
    if (done) stream.end('data: [DONE]\n\n');
  };
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()); calls.push(payload);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.flushHeaders(); stream = res;
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    const launch = process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] };
    app = await electron.launch({ ...launch, env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => ['pet', 'panel'].every(name => app.windows().some(p => p.url().includes(`page=${name}`))));
    const page = name => app.windows().find(p => p.url().includes(`page=${name}`)); const panel = page('panel'), pet = page('pet');
    await pet.waitForSelector('canvas');
    await panel.evaluate(async url => {
      const boot = await window.pet.bootstrap(); await window.pet.saveSettings({ ...boot.settings, paused: true, clickThrough: false, bubbles: true });
      await window.pet.panelRequest({ type: 'command', command: { protocolVersion: 1, commandId: crypto.randomUUID(), type: 'stop_current' } });
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.baseUrl = url; config.model.model = 'local-stream-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.speech.enabled = false;
      const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw new Error(result.message);
    }, `http://127.0.0.1:${backend.address().port}/v1`);
    await app.evaluate(({ screen, BrowserWindow, ipcMain }) => {
      globalThis.testPointer = { x: -9000, y: -9000 }; screen.getCursorScreenPoint = () => globalThis.testPointer;
      ipcMain.on('hit-regions', (_event, regions) => { globalThis.testRegions = regions; });
      const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet'));
      const area = screen.getDisplayMatching(pet.getBounds()).workArea;
      pet.setPosition(area.x + Math.round(area.width / 2) - 170, area.y + area.height - 450);
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')).focus();
    });
    await wait(() => app.evaluate(() => Boolean(globalThis.testRegions?.length)), '角色命中区域');
    const info = name => app.evaluate(({ BrowserWindow }, name) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`page=${name}`)); return w ? { visible: w.isVisible(), focus: w.isFocused(), focusable: w.isFocusable(), bounds: w.getBounds() } : null; }, name);
    const hover = () => app.evaluate(({ BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')).getBounds();
      const region = globalThis.testRegions.find(r => r.target === 'body') ?? globalThis.testRegions[0];
      globalThis.testPointer = { x: Math.round(bounds.x + region.x + region.width / 2), y: Math.round(bounds.y + region.y + region.height / 2) }; return globalThis.testPointer;
    });
    const away = () => app.evaluate(() => { globalThis.testPointer = { x: -9000, y: -9000 }; });
    // 三个原生窗口的截图按真实屏幕坐标合成，检查人物、尖角和脚下输入条的相对位置。
    const compose = async name => {
      const parts = [];
      for (const kind of ['pet', 'speech-bubble', 'quick-chat']) {
        const b = (await info(kind)).bounds; const shot = await page(kind).screenshot({ omitBackground: true });
        parts.push({ bounds: b, input: await sharp(shot).resize(b.width * 2, b.height * 2).png().toBuffer() });
      }
      const x = Math.min(...parts.map(p => p.bounds.x)) - 16, y = Math.min(...parts.map(p => p.bounds.y)) - 16;
      const width = Math.max(...parts.map(p => p.bounds.x + p.bounds.width)) - x + 16, height = Math.max(...parts.map(p => p.bounds.y + p.bounds.height)) - y + 16;
      await sharp({ create: { width: width * 2, height: height * 2, channels: 4, background: '#eef3fa' } }).composite(parts.map(p => ({ input: p.input, left: (p.bounds.x - x) * 2, top: (p.bounds.y - y) * 2 }))).png().toFile(path.join(folder, name));
    };
    const originalPet = (await info('pet')).bounds;
    await hover(); await wait(async () => (await info('quick-chat'))?.visible, '悬停打开');
    const chat = page('quick-chat'); await chat.getByLabel('和大肥鱼聊天').waitFor();
    assert.equal((await info('quick-chat')).focus, false); check('悬停显示输入框且不抢焦点');
    assert.equal(await chat.getByRole('button').count(), 1); assert.equal(await chat.locator('header,.quick-reply,.quick-footer').count(), 0);
    const inputBounds = (await info('quick-chat')).bounds;
    const localFeet = await app.evaluate(() => Math.max(...globalThis.testRegions.map(r => r.y + r.height)));
    assert.equal(inputBounds.height, 58); assert.ok(Math.abs(inputBounds.y - (await info('pet')).bounds.y - localFeet - 3) <= 1);
    check('输入框是脚底下方的长条，仅有输入和一个发送按钮');
    await chat.getByLabel('和大肥鱼聊天').fill('输入法确认');
    await chat.getByLabel('和大肥鱼聊天').dispatchEvent('compositionstart');
    await chat.getByLabel('和大肥鱼聊天').press('Enter'); await delay(150); assert.equal(calls.length, 0);
    await chat.getByLabel('和大肥鱼聊天').dispatchEvent('compositionend');
    await chat.getByLabel('和大肥鱼聊天').press('Shift+Enter'); assert.equal(calls.length, 0); check('中文输入法确认和换行均不会误发送');
    await away(); await delay(1100); assert.equal((await info('quick-chat')).visible, true); check('移开鼠标保留未发送草稿');
    await chat.getByLabel('和大肥鱼聊天').fill('我们聊聊吧');
    const petBefore = (await info('pet')).bounds;
    await chat.getByLabel('和大肥鱼聊天').press('Enter'); await wait(() => Boolean(stream));
    assert.equal(calls[0].stream, true); push('你好呀！');
    await wait(() => Boolean(page('speech-bubble')), '创建气泡'); const bubble = page('speech-bubble');
    await bubble.waitForFunction(() => document.querySelector('.speech-content')?.textContent.includes('你好呀'));
    assert.equal(stream.writableEnded, false); assert.equal(await chat.evaluate(async () => (await window.pet.quickChat({ type: 'state' })).state.reply), '你好呀！');
    await delay(150); const short = (await info('speech-bubble')).bounds;
    const style = await bubble.locator('.speech-bubble').evaluate(el => ({ color: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius }));
    assert.equal(style.color, 'rgb(57, 121, 201)'); assert.equal(style.radius, '10px'); assert.equal((await info('speech-bubble')).focusable, false);
    assert.equal(await bubble.locator('.speech-tail path').count(), 1);
    const headTop = await app.evaluate(() => globalThis.testRegions.find(r => r.target === 'head').y);
    assert.equal(await bubble.locator('.speech-shell').getAttribute('data-side'), 'bottom');
    assert.ok(Math.abs(petBefore.y + headTop - (short.y + short.height - 4) - 6) <= 1);
    await bubble.screenshot({ path: path.join(folder, 'short.png'), omitBackground: true }); await compose('layout-short.png');
    check('真正 SSE 增量输出，尖角指向头顶且相距约 6 DIP');
    const more = '\n我在这里陪你。今天有什么想分享的？\n你可以一边看我的回复，一边准备下一句话。文字变多时，气泡会自动展开。\n靠近屏幕边缘时，我也会把气泡挪到合适的位置。🐟';
    push(more, true);
    await bubble.waitForFunction(() => document.querySelector('.speech-content')?.textContent.endsWith('🐟'));
    await wait(async () => !(await chat.evaluate(async () => (await window.pet.quickChat({ type: 'state' })).state.busy)));
    const expanded = (await info('speech-bubble')).bounds;
    assert.ok(expanded.width > short.width); assert.ok(expanded.height > short.height); assert.deepEqual((await info('pet')).bounds, petBefore);
    await bubble.screenshot({ path: path.join(folder, 'expanded.png'), omitBackground: true }); await chat.screenshot({ path: path.join(folder, 'input.png'), omitBackground: true });
    await compose('layout-expanded.png');
    assert.equal(calls.length, 1); check('内容自适应宽高、完整中文和表情、角色尺寸与位置保持不变');
    const forbidden = await chat.evaluate(async () => { try { await window.pet.companion({ type: 'state' }); return false; } catch (e) { return String(e).includes('IPC_FORBIDDEN'); } }); assert.equal(forbidden, true); check('快捷聊天窗口无法读取完整记忆或配置');
    await hover(); await chat.getByLabel('和大肥鱼聊天').press('Escape'); await delay(1200); assert.equal((await info('quick-chat')).visible, false);
    assert.deepEqual((await info('pet')).bounds, originalPet); check('底部临时留出输入空间，关闭后角色回到原位置');
    await away(); await delay(100); await hover(); await wait(async () => (await info('quick-chat'))?.visible); check('手动关闭不立即重弹，移开再悬停可打开');
    const resetPosition = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet'));
      const b = w.getBounds(), a = screen.getDisplayMatching(b).workArea;
      w.setPosition(a.x + 120, a.y + a.height - b.height); return w.getBounds();
    });
    await hover(); await delay(250); await chat.getByLabel('和大肥鱼聊天').press('Escape'); await delay(150);
    assert.deepEqual((await info('pet')).bounds, resetPosition); check('聊天期间重置角色位置，收起时不会使用过期恢复坐标');
    await away(); await delay(100); await hover(); await wait(async () => (await info('quick-chat')).visible);
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')); const a = screen.getDisplayMatching(w.getBounds()).workArea; w.setPosition(a.x + a.width - w.getBounds().width, a.y); });
    await hover(); await delay(200);
    const area = await app.evaluate(({ screen, BrowserWindow }) => screen.getDisplayMatching(BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')).getBounds()).workArea);
    for (const name of ['quick-chat', 'speech-bubble']) { const b = (await info(name)).bounds; assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height); }
    assert.equal(await bubble.locator('.speech-shell').getAttribute('data-side'), 'right'); await compose('layout-edge.png');
    check('屏幕边缘自动避让，两个窗口完整位于工作区');
    const point = await hover(); await pet.evaluate(async point => { await window.pet.pointerDown(point); if (!await window.pet.dragStart()) throw new Error('拖动未启动'); }, point);
    await wait(async () => !(await info('quick-chat')).visible); assert.equal((await info('speech-bubble')).visible, false); await pet.evaluate(() => window.pet.dragEnd()); check('拖动桌宠会收起输入和气泡，保留原有拖动交互');
    await away(); await delay(100); await hover(); await wait(async () => (await info('quick-chat')).visible);
    stream = undefined; await chat.getByLabel('和大肥鱼聊天').fill('停止测试'); await chat.getByLabel('和大肥鱼聊天').press('Enter'); await wait(() => Boolean(stream)); push('正在回复，还没说完');
    await bubble.waitForFunction(() => document.querySelector('.speech-content')?.textContent.includes('还没说完'));
    await chat.getByRole('button', { name: '停止', exact: true }).click(); await wait(async () => !(await info('speech-bubble')).visible);
    const s = await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state); assert.equal(s.data.events.filter(e => e.actor === 'pet').length, 1); check('停止流式回复立即收起气泡，半句不会写入聊天记录');
    await pet.evaluate(() => window.pet.openPanel()); await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '陪伴设置', exact: true }).waitFor(); check('完整设置仍可从桌宠小屋打开');
    assert.deepEqual(errors, []); check('无渲染错误');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors, userDir, provider: '本机 SSE 模拟模型，未使用真实账号' }, null, 2));
  } finally { if (app) await app.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
