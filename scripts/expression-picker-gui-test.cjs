// 隔离用户资料，模拟鼠标位置、文件选择和模型 SSE；实际窗口、IPC、图片与消息保存走生产代码。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const sharp = require('sharp');

(async () => {
  const folder = path.resolve(`test-results/expression-picker${process.env.PET_TEST_EXECUTABLE ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')), checks = [], errors = [], calls = [];
  const image = path.join(userDir, '鼓励.gif');
  await sharp(Buffer.concat([Buffer.alloc(48 * 48 * 3, 50), Buffer.alloc(48 * 48 * 3, 220)]), { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } }).gif({ loop: 0, delay: [150, 150] }).toFile(image);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { const until = Date.now() + 30000; while (Date.now() < until) { if (await fn()) return; await delay(80); } throw Error(`等待超时：${label}`); };
  const check = text => { checks.push(text); console.log('PASS', text); };
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const chunk of req) parts.push(chunk); calls.push(JSON.parse(Buffer.concat(parts)));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '收到，我们继续一起学习。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel, chat;
  const state = async () => (await panel.evaluate(() => window.pet.companion({ type: 'state' }))).state;
  const sendDone = async count => { await wait(async () => calls.length === count && !(await state()).busy, '模型回复完成'); await chat.getByRole('button', { name: '发送', exact: true }).waitFor(); };
  const launch = async () => {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋'); panel = app.windows().find(p => p.url().includes('page=panel'));
  };
  const openPicker = async (page, tab) => {
    if (page === chat) {
      // 小屋操作期间空草稿快捷窗会正常收起，回到桌宠重新悬停，不能依赖上一窗口仍留在屏幕上。
      await app.evaluate(({ BrowserWindow }) => {
        const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')).getBounds(), r = globalThis.expressionRegions.find(r => r.target === 'body');
        globalThis.expressionPointer = { x: b.x + r.x + r.width / 2, y: b.y + r.y + r.height / 2 };
      });
      await wait(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=quick-chat'))?.isVisible()), '重新悬停打开聊天');
    }
    await page.getByRole('button', { name: '选择表情', exact: true }).click(); await page.getByRole('tab', { name: tab, exact: true }).click();
  };
  const chooseLocal = async page => { await openPicker(page, '表情包'); await page.getByLabel('搜索可发送的表情').fill('鼓励'); await page.getByRole('button', { name: '选择表情 鼓励', exact: true }).click(); await page.getByLabel('待发送表情', { exact: true }).waitFor(); };
  try {
    await launch();
    await app.evaluate(({ dialog, screen, ipcMain }, image) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] });
      globalThis.expressionPointer = { x: -9000, y: -9000 }; screen.getCursorScreenPoint = () => globalThis.expressionPointer;
      ipcMain.on('hit-regions', (_event, regions) => { globalThis.expressionRegions = regions; });
    }, image);
    const local = await panel.evaluate(async url => {
      const imported = await window.pet.stickers({ type: 'import-images' }); if (!imported.ok) throw Error(imported.message);
      const item = imported.items[0]; await window.pet.stickers({ type: 'edit-local', id: item.id, details: { name: '鼓励', emotion: '开心', tags: ['学习'], use: '答对题时加油' } });
      await window.pet.stickers({ type: 'configure', settings: { ...imported.state.settings, enabled: false, offline: true, packs: [], blocked: [item.id] } });
      const boot = await window.pet.bootstrap(); await window.pet.saveSettings({ ...boot.settings, paused: true, clickThrough: false, bubbles: true });
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.model = 'expression-fixture'; config.model.baseUrl = url; config.memory.automatic = false; config.mood.enabled = false; config.speech.enabled = false;
      const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw Error(result.message);
      return item;
    }, `http://127.0.0.1:${server.address().port}/v1`);
    await wait(() => app.evaluate(() => Boolean(globalThis.expressionRegions?.length)), '角色命中区域');
    await app.evaluate(({ BrowserWindow, screen }) => {
      const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')); const area = screen.getDisplayMatching(pet.getBounds()).workArea;
      pet.setPosition(area.x + Math.round(area.width / 2) - 170, area.y + area.height - 440);
      const b = pet.getBounds(), r = globalThis.expressionRegions.find(r => r.target === 'body');
      globalThis.expressionPointer = { x: b.x + r.x + r.width / 2, y: b.y + r.y + r.height / 2 };
    });
    await wait(() => app.windows().some(p => p.url().includes('page=quick-chat')), '快捷聊天'); chat = app.windows().find(p => p.url().includes('page=quick-chat'));
    const input = chat.getByLabel('和大肥鱼聊天'); await input.fill('早上好'); await input.evaluate(el => el.setSelectionRange(2, 2));
    await openPicker(chat, 'Emoji');
    assert.equal(await chat.getByRole('tablist', { name: '表情类型' }).getByRole('tab').count(), 2);
    await app.evaluate(() => { globalThis.expressionPointer = { x: -9000, y: -9000 }; }); await delay(1200);
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=quick-chat')); return { visible: w.isVisible(), bounds: w.getBounds(), area: screen.getDisplayMatching(w.getBounds()).workArea }; });
    assert.ok(bounds.visible); assert.equal(bounds.bounds.height, 380); assert.ok(bounds.bounds.y + bounds.bounds.height <= bounds.area.y + bounds.area.height);
    await chat.screenshot({ path: path.join(folder, 'quick-emoji.png'), omitBackground: true });
    await chat.getByRole('button', { name: '微笑 😊', exact: true }).click(); assert.equal(await input.inputValue(), '早上😊好'); assert.equal(await input.evaluate(el => el.selectionStart), 4);
    await openPicker(chat, 'Emoji'); await chat.getByRole('tab', { name: 'Emoji', exact: true }).press('Escape');
    await wait(() => chat.getByRole('region', { name: '表情选择器' }).count().then(n => n === 0), 'Escape 收起选择器');
    assert.equal(await chat.getByRole('dialog', { name: '大肥鱼快捷菜单' }).isVisible(), true); assert.equal(await input.inputValue(), '早上😊好');
    assert.equal(calls.length, 0); check('输入框表情按钮分为 Emoji / 表情包两个子选项；窗口展开在屏内，Emoji 在光标处插入且不发送');
    await openPicker(chat, 'Emoji'); await chat.getByRole('tab', { name: 'Emoji', exact: true }).press('ArrowRight');
    await chat.getByLabel('搜索可发送的表情').waitFor(); await chat.getByLabel('选择表情套组').selectOption('我的表情');
    await chat.getByRole('button', { name: '选择表情 鼓励', exact: true }).waitFor(); await chat.screenshot({ path: path.join(folder, 'quick-stickers.png'), omitBackground: true });
    await chat.getByRole('button', { name: '选择表情 鼓励', exact: true }).click(); await chat.getByLabel('待发送表情', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), '早上😊好'); await chat.getByRole('tab', { name: '状态', exact: true }).click(); await chat.getByRole('tab', { name: '聊天', exact: true }).click();
    await chat.getByLabel('待发送表情', { exact: true }).waitFor(); await chat.screenshot({ path: path.join(folder, 'quick-draft.png'), omitBackground: true });
    await chat.getByRole('button', { name: '移除待发送表情' }).click(); assert.equal((await panel.evaluate(() => window.pet.stickers({ type: 'state' }))).state.localCount, 1);
    check('键盘切换子选项、筛选我的表情、选择 GIF 与切换状态保留草稿，移除附件不删除图库');
    await chooseLocal(chat); await input.fill(''); await chat.getByRole('button', { name: '发送', exact: true }).click(); await sendDone(1);
    const user = (await state()).data.events.find(e => e.actor === 'user'); assert.ok(user.text.includes(local.image)); assert.ok(user.text.includes('情绪：开心')); assert.ok(user.text.includes('场景：答对题时加油'));
    assert.ok(calls[0].messages.at(-1).content.includes(local.image)); assert.ok(calls[0].messages[0].content.includes('没有收到图像像素'));
    assert.ok(!calls[0].messages.some(m => Array.isArray(m.content))); check('关闭自动表情并禁用单图后用户仍可主动单独发送；真实聊天保存 GIF，模型收到文字资料而非图片上传');
    await chooseLocal(chat); await input.fill('一起加油 😊'); await chat.getByRole('button', { name: '发送', exact: true }).click(); await sendDone(2);
    assert.ok(calls[1].messages.at(-1).content.startsWith('一起加油 😊\n\n!['));
    check('文字、Emoji 和表情包可合并成一条消息，不产生重复用户消息');
    await openPicker(chat, '表情包');
    await wait(() => chat.locator('.expression-stickers button').count().then(n => n > 0), '上游目录');
    const remote = chat.locator('.expression-stickers button').filter({ hasText: '点击加载' }).first(); await remote.click();
    await chat.locator('.expression-feedback').filter({ hasText: /离线|下载/ }).waitFor(); assert.equal(calls.length, 2);
    await chat.getByRole('button', { name: '关闭表情选择器' }).click(); check('离线时未缓存表情展示错误，不误发送、不回退成其他图片');
    const denied = await chat.evaluate(async () => {
      const results = []; for (const run of [() => window.pet.stickers({ type: 'state' }), () => window.pet.stickerPicker({ type: 'import-images' }), () => window.pet.stickerPicker({ type: 'prepare', id: 'x', bubble: true })]) { try { await run(); results.push(false); } catch { results.push(true); } } return results;
    }); assert.deepEqual(denied, [true, true, true]); check('快捷窗口只能浏览和准备图片，不能导入、删除或调用完整管理 IPC');
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); const houseInput = panel.getByLabel('对大肥鱼说'); await houseInput.fill('今天');
    await openPicker(panel, 'Emoji'); await panel.locator('.expression-picker').screenshot({ path: path.join(folder, 'house-picker.png') }); await panel.getByRole('button', { name: '完成 ✅', exact: true }).click(); assert.equal(await houseInput.inputValue(), '今天✅');
    await chooseLocal(panel); await panel.getByRole('button', { name: '发送', exact: true }).click(); await wait(async () => calls.length === 3 && !(await state()).busy, '小屋图文消息');
    await wait(() => panel.locator('.companion-message.user img.chat-sticker').evaluateAll(images => images.length === 3 && images.every(img => img.complete && img.naturalWidth === 48)), '三条用户消息显示图片');
    await panel.screenshot({ path: path.join(folder, 'house-chat.png') }); check('小屋共用选择器，用户发送的图片正常展示在聊天记录中');
    await chooseLocal(chat); await input.fill('失败后保留我'); await panel.evaluate(id => window.pet.stickers({ type: 'delete-local', id }), local.id);
    await chat.getByRole('button', { name: '发送', exact: true }).click(); await chat.getByLabel('待发送表情', { exact: true }).waitFor();
    await wait(async () => await input.inputValue() === '失败后保留我', '失败恢复草稿'); assert.equal(calls.length, 3);
    await chat.getByLabel('待发送表情', { exact: true }).getByRole('status').filter({ hasText: /重新选择/ }).waitFor();
    check('发送前表情被删除会阻止发送，文字和附件草稿恢复，错误可见');
    await app.close(); app = undefined; await launch();
    const history = (await state()).data.events.filter(e => e.actor === 'user'); assert.equal(history.length, 3); assert.ok(history.every(e => e.text.includes(local.image)));
    assert.deepEqual(errors, []); check('重启保留图文消息记录，整个测试没有渲染异常');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors, modelRequests: calls.length, model: '本地 SSE 夹具；原生 Electron 窗口与实际聊天链路，未调用用户账号或语音合成' }, null, 2));
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
