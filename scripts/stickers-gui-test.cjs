// 真实 Electron 窗口与上游 GIF；模型为本机 SSE 夹具，使用独立 userData。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/stickers${packaged ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const catalog = JSON.parse(await fs.readFile('plugins/nekowhale-stickers/catalog.json', 'utf8'));
  const sticker = catalog.items.find(item => item.name === '猫猫搓手');
  const checks = [], errors = [], calls = [];
  const check = text => { checks.push(text); console.log('PASS', text); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label = '') => { const end = Date.now() + 40000; while (Date.now() < end) { if (await fn()) return; await delay(100); } throw new Error(`等待超时：${label}`); };
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
    const names = (body.tools ?? []).map(tool => tool.function.name);
    const lastUser = [...body.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const lastUserIndex = body.messages.findLastIndex(m => m.role === 'user');
    const results = body.messages.slice(lastUserIndex + 1).filter(m => m.role === 'tool');
    let delta = { content: '继续陪你聊天。' }, finish_reason = 'stop';
    if (lastUser.includes('发一个期待的表情') && names.includes('dafeiyu_sticker_search')) {
      if (results.length < 2) {
        const name = results.length === 0 ? 'dafeiyu_sticker_search' : 'dafeiyu_sticker_send';
        delta = { tool_calls: [{ index: 0, id: `fixture-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(results.length === 0 ? { query: '期待', limit: 5 } : { id: sticker.id }) } }] }; finish_reason = 'tool_calls';
      } else delta = { content: '搓搓手，期待你的好消息！' }; // 故意不写图片链接，验证宿主自动附图。
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel;
  const page = name => app.windows().find(page => page.url().includes(`page=${name}`));
  const launch = async () => {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', win => win.on('pageerror', error => errors.push(error.message)));
    await app.firstWindow(); await wait(() => Boolean(page('panel')) && Boolean(page('pet')));
    panel = page('panel'); await panel.getByRole('button', { name: '表情包', exact: true }).waitFor();
  };
  const openStickers = async () => { await panel.getByRole('button', { name: '表情包', exact: true }).click(); await panel.getByLabel('搜索表情').waitFor(); };
  const preview = async () => {
    await panel.getByLabel('搜索表情').fill('猫猫搓手');
    await panel.getByRole('button', { name: '预览 猫猫搓手', exact: true }).click();
    await panel.locator('.sticker-large img').waitFor();
    await wait(() => panel.locator('.sticker-large img').evaluate(img => img.complete && img.naturalWidth === 300), '真实 GIF 加载');
  };
  const state = () => panel.evaluate(async () => (await window.pet.stickers({ type: 'state' })).state);
  try {
    await launch(); await openStickers();
    assert.equal((await state()).total, 322); assert.equal((await state()).settings.enabled, false); assert.equal((await state()).cached, 0);
    check('首次打开离线列出 322 张表情，默认不下载、不自动使用');
    await panel.getByRole('button', { name: '摸鱼', exact: true }).click(); await wait(async () => (await panel.getByLabel('搜索表情').inputValue()) === '摸鱼' && await panel.locator('.sticker-tile').count() > 0);
    check('中文场景搜索和分页入口可用');
    await preview();
    const cached = await fs.readdir(path.join(userDir, 'stickers/cache'));
    const gif = await fs.readFile(path.join(userDir, 'stickers/cache', cached.find(name => name.endsWith('.gif'))));
    assert.ok(createHash('sha1').update(gif).digest('hex').startsWith(sticker.hash)); assert.equal(gif.length, sticker.bytes);
    const frames = []; for (let i = 0; i < 4; i++) { frames.push(createHash('sha256').update(await panel.locator('.sticker-large img').screenshot()).digest('hex')); await delay(180); }
    assert.ok(new Set(frames).size > 1, 'GIF 必须播放不同画面');
    await panel.screenshot({ path: path.join(folder, 'library.png') });
    check('从原素材站下载真实 GIF，文件哈希正确且画面实际变化');
    const before = await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state.data.events.length);
    await panel.getByRole('button', { name: '在气泡预览', exact: true }).click();
    await wait(() => Boolean(page('speech-bubble'))); const bubble = page('speech-bubble');
    await bubble.locator('img.chat-sticker').waitFor(); await wait(() => bubble.locator('img.chat-sticker').evaluate(img => img.complete && img.naturalWidth === 300));
    assert.equal(await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state.data.events.length), before);
    await bubble.screenshot({ path: path.join(folder, 'preview-bubble.png'), omitBackground: true });
    check('桌面气泡显示真实动态表情，手动预览不写入对话或学习记录');
    const forbidden = await bubble.evaluate(async () => { try { await window.pet.stickers({ type: 'configure', settings: {} }); return false; } catch { return true; } }); assert.equal(forbidden, true);
    check('气泡无法调用表情管理 IPC');
    await panel.getByRole('switch', { name: /允许大肥鱼使用表情包/ }).click();
    await wait(async () => (await state()).settings.enabled); assert.equal(await panel.getByRole('switch', { name: /允许大肥鱼使用表情包/ }).isChecked(), true);
    await panel.evaluate(async url => {
      const boot = await window.pet.bootstrap(); await window.pet.saveSettings({ ...boot.settings, paused: true, bubbles: true });
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.baseUrl = url; config.model.model = 'sticker-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.speech.enabled = false;
      const r = await window.pet.companion({ type: 'configure', config }); if (!r.ok) throw new Error(r.message);
    }, `http://127.0.0.1:${backend.address().port}/v1`);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.getByLabel('对大肥鱼说').fill('发一个期待的表情'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await panel.locator('.companion-message.pet img.chat-sticker').waitFor();
    await wait(() => panel.locator('.companion-message.pet img.chat-sticker').evaluate(img => img.complete && img.naturalWidth === 300));
    const reply = await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state.data.events.at(-1).text);
    assert.ok(reply.includes('petsticker://local/')); assert.equal(reply.match(/!\[/g).length, 1);
    assert.ok(calls.some(body => body.messages.some(m => m.role === 'tool' && m.content.includes('表情已准备好'))));
    await panel.screenshot({ path: path.join(folder, 'chat.png') }); await bubble.screenshot({ path: path.join(folder, 'chat-bubble.png'), omitBackground: true });
    check('模型通过真实工具路由搜索/选择，宿主自动附一张 GIF 并保存聊天记录');
    await openStickers(); await panel.getByRole('switch', { name: /允许大肥鱼使用表情包/ }).click(); await wait(async () => !(await state()).settings.enabled);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    const previousCalls = calls.length; await panel.getByLabel('对大肥鱼说').fill('关闭后继续聊'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await panel.getByText('继续陪你聊天。', { exact: true }).waitFor();
    assert.ok(calls.length > previousCalls); assert.ok(calls.slice(previousCalls).every(body => !(body.tools ?? []).some(t => t.function.name.startsWith('dafeiyu_sticker_'))));
    check('关闭后立即移除模型工具，正常文字对话继续');
    await openStickers(); await panel.getByLabel('仅使用已下载表情', { exact: true }).click();
    await wait(async () => (await state()).settings.offline);
    await app.close(); app = undefined; await launch(); await openStickers();
    assert.equal((await state()).settings.offline, true); assert.equal((await state()).cached, 1);
    await app.evaluate(() => { const original = globalThis.fetch; globalThis.stickerNetworkCalls = 0; globalThis.fetch = (input, init) => { if (String(input).startsWith('https://kiriyuki.com')) { globalThis.stickerNetworkCalls++; throw new Error('测试断网'); } return original(input, init); }; });
    await preview(); assert.equal(await app.evaluate(() => globalThis.stickerNetworkCalls), 0);
    await panel.getByLabel('不让大肥鱼自动选用这张', { exact: true }).click(); await wait(async () => (await state()).settings.blocked.includes(sticker.id));
    check('重启保留缓存与离线设置，断网仍能播放，单张禁用可保存');
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.locator('.companion-message.pet img.chat-sticker').waitFor(); await wait(() => panel.locator('.companion-message.pet img.chat-sticker').evaluate(img => img.complete && img.naturalWidth === 300));
    check('重启后历史消息的 GIF 仍可显示');
    await openStickers(); await preview();
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')); w.setSize(800, 620); });
    await delay(300); assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await panel.screenshot({ path: path.join(folder, 'small-window.png') });
    check('800×620 小屋完整可滚动，无横向溢出');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.PET_TEST_STICKER_SOURCE] }); });
    // 测试只替换原生目录选择结果，导入路径仍走生产校验与复制。
    await app.evaluate((_electron, source) => { process.env.PET_TEST_STICKER_SOURCE = source; }, path.resolve('plugins/nekowhale-stickers'));
    await panel.getByRole('button', { name: '导入／更新插件', exact: true }).click();
    await panel.getByText('表情插件已更新，请查看来源后开启自动选用', { exact: true }).waitFor();
    assert.equal((await state()).settings.enabled, false); assert.equal((await state()).plugin.version, '1.0.0');
    check('独立插件目录导入成功，版本单独维护，更新后自动选用保持关闭');
    await panel.getByRole('button', { name: '清理下载缓存', exact: true }).click(); await wait(async () => (await state()).cached === 0);
    await panel.getByLabel('搜索表情').fill('猫猫搓手'); await panel.getByRole('button', { name: '预览 猫猫搓手', exact: true }).click();
    await panel.getByText('这张表情尚未缓存；关闭“仅使用已下载表情”后可下载', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.stickerNetworkCalls), 0);
    check('清理缓存保留设置，离线缺图明确提示且不偷偷联网');
    assert.deepEqual(errors, []); check('无渲染异常');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors, userDir, gif: { id: sticker.id, bytes: gif.length, sha1: createHash('sha1').update(gif).digest('hex') }, model: '本机 SSE 夹具；GIF 来自真实 kiriyuki.com，未使用模型账号' }, null, 2));
  } finally { if (app) await app.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
