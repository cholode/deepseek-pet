// 隔离 userData；只替换原生文件选择结果，导入、解码、存储、工具路由、协议和窗口均使用生产代码。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sharp = require('sharp');

(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/local-stickers${packaged ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')), source = await fs.mkdtemp(path.join(folder, 'images-'));
  const png = await sharp({ create: { width: 96, height: 96, channels: 4, background: '#509cff' } }).png().toBuffer();
  const frames = Buffer.concat([Buffer.alloc(64 * 64 * 3, 40), Buffer.alloc(64 * 64 * 3, 220)]);
  const gif = await sharp(frames, { raw: { width: 64, height: 128, channels: 3, pageHeight: 64 } }).gif({ loop: 0, delay: [200, 200] }).toBuffer();
  const images = { '开心.png': png, '动起来.gif': gif, '笑脸.jpg': await sharp(png).jpeg().toBuffer(), '鼓励.webp': await sharp(png).webp().toBuffer(), '坏图.gif': Buffer.from('<html>not an image file</html>') };
  const files = await Promise.all(Object.entries(images).map(async ([name, bytes]) => { const file = path.join(source, name); await fs.writeFile(file, bytes); return file; }));
  const checks = [], errors = [], calls = []; let app, panel;
  const check = text => { checks.push(text); console.log('PASS', text); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { const until = Date.now() + 30000; while (Date.now() < until) { if (await fn()) return; await delay(100); } throw Error(`等待超时：${label}`); };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    const last = body.messages.findLastIndex(m => m.role === 'user'); const results = body.messages.slice(last + 1).filter(m => m.role === 'tool');
    let delta = { content: '答对了，我们一起庆祝！' }, finish_reason = 'stop';
    if (results.length < 2) {
      const name = results.length ? 'dafeiyu_sticker_send' : 'dafeiyu_sticker_search';
      const args = results.length ? { id: JSON.parse(results[0].content)[0].id } : { query: '学会了', limit: 5 };
      delta = { tool_calls: [{ index: 0, id: `sticker-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }; finish_reason = 'tool_calls';
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = async () => {
    app = await electron.launch(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'], env } : { args: [path.resolve('.'), '--panel'], env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await wait(() => app.windows().some(page => page.url().includes('page=panel')), '小屋'); panel = app.windows().find(page => page.url().includes('page=panel'));
    await app.evaluate(({ dialog }, { files, plugin }) => {
      dialog.showOpenDialog = async (_window, options) => { globalThis.lastImageDialog = options; return { canceled: false, filePaths: options.properties.includes('openDirectory') ? [plugin] : files }; };
      const fetch = globalThis.fetch; globalThis.externalFetches = 0;
      globalThis.fetch = (input, init) => { if (!String(input).startsWith('http://127.0.0.1:')) { globalThis.externalFetches++; throw Error('测试期间禁止外网'); } return fetch(input, init); };
    }, { files, plugin: path.resolve('plugins/nekowhale-stickers') });
    await panel.getByRole('button', { name: '表情包', exact: true }).click(); await panel.getByRole('button', { name: '导入图片／GIF', exact: true }).waitFor();
  };
  const state = async () => (await panel.evaluate(() => window.pet.stickers({ type: 'state' }))).state;
  const select = async name => {
    await panel.getByLabel('搜索表情').fill(name); await panel.getByRole('button', { name: `预览 ${name}`, exact: true }).click();
    await wait(() => panel.locator('.sticker-large img').evaluate(img => img.complete && img.naturalWidth > 0), '本地图片加载');
  };
  try {
    await launch();
    await panel.getByRole('button', { name: '导入图片／GIF', exact: true }).click();
    await wait(async () => (await state()).localCount === 4, '四种图片导入');
    await panel.getByText(/已导入 4 张，已有 0 张；1 张未导入/).waitFor();
    assert.ok((await app.evaluate(() => globalThis.lastImageDialog)).properties.includes('multiSelections'));
    assert.equal((await state()).total, 326); assert.equal((await state()).cached, 0);
    const items = (await panel.evaluate(() => window.pet.stickers({ type: 'search', query: '', pack: '我的表情' }))).items;
    assert.equal(items.length, 4); assert.ok(items.every(item => item.local));
    for (const item of items) {
      await select(item.name);
      assert.ok(await panel.locator('.sticker-tile.selected .sticker-thumbnail img').evaluate(img => {
        const image = img.getBoundingClientRect(), frame = img.parentElement.getBoundingClientRect();
        return image.width <= frame.width + 1 && image.height <= frame.height + 1;
      }), '缩略图应完整放在预览框内，不覆盖名称');
      const mime = await app.evaluate(async ({ net }, image) => (await net.fetch(image)).headers.get('content-type'), item.image);
      assert.equal(mime, `image/${item.image.split('.').at(-1)}`);
    }
    check('原生多选入口导入 PNG/JPG/WebP/GIF，混入坏图时其余成功，协议 MIME 正确');
    await select('动起来'); const animated = items.find(item => item.name === '动起来'); assert.equal(animated.frames, 2);
    const hashes = []; for (let i = 0; i < 5; i++) { hashes.push(createHash('sha256').update(await panel.locator('.sticker-large img').screenshot()).digest('hex')); await delay(130); }
    assert.ok(new Set(hashes).size > 1); assert.deepEqual(await fs.readFile(path.join(userDir, 'stickers/local', new URL(animated.image).pathname.slice(1))), gif);
    await panel.getByRole('button', { name: '在气泡预览', exact: true }).click();
    await wait(() => app.windows().some(p => p.url().includes('page=speech-bubble')), '桌面气泡');
    const bubble = app.windows().find(p => p.url().includes('page=speech-bubble')); await bubble.locator('img.chat-sticker').waitFor();
    check('本地 GIF 原字节保留，真实窗口动画帧变化，桌面气泡可播放');
    await select('开心');
    await panel.getByLabel('表情名称', { exact: true }).fill('庆祝练习'); await panel.getByLabel('表情情绪', { exact: true }).fill('开心');
    await panel.getByLabel('表情关键词', { exact: true }).fill('日语，学会了'); await panel.getByLabel('表情使用场景', { exact: true }).fill('完成单词学习时，开心庆祝');
    await panel.getByRole('button', { name: '保存表情资料', exact: true }).click(); await panel.getByText('表情资料已保存，大肥鱼会按新描述选用', { exact: true }).waitFor();
    await panel.getByLabel('搜索表情').fill('学会了'); await panel.getByRole('button', { name: '预览 庆祝练习', exact: true }).waitFor();
    await panel.screenshot({ path: path.join(folder, 'editor.png'), fullPage: true });
    await panel.getByRole('button', { name: '导入图片／GIF', exact: true }).click(); await panel.getByText(/已导入 0 张，已有 4 张/).waitFor(); assert.equal((await state()).localCount, 4);
    assert.equal((await panel.evaluate(() => window.pet.stickers({ type: 'search', query: '学会了', pack: '我的表情' }))).items[0].name, '庆祝练习');
    check('编辑名称/情绪/关键词/场景后可搜索，重复导入去重且保留描述');
    await panel.evaluate(async url => {
      const sticker = await window.pet.stickers({ type: 'state' }); const r = await window.pet.stickers({ type: 'configure', settings: { ...sticker.state.settings, enabled: true, offline: true, frequency: 'always', packs: ['我的表情'] } }); if (!r.ok) throw Error(r.message);
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.baseUrl = url; config.model.model = 'local-sticker-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.speech.enabled = false;
      const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw Error(result.message);
    }, `http://127.0.0.1:${server.address().port}/v1`);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByLabel('对大肥鱼说').fill('我学会了，请用我的表情庆祝'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await panel.locator('.companion-message.pet img.chat-sticker').waitFor();
    await wait(() => panel.locator('.companion-message.pet img.chat-sticker').evaluate(img => img.complete && img.naturalWidth === 96), '聊天中显示本地 PNG');
    assert.ok(calls.some(body => body.messages.some(m => m.role === 'tool' && m.content.includes('custom:'))));
    await panel.screenshot({ path: path.join(folder, 'chat.png') }); check('真实聊天工具链根据用户填写的描述选中本地表情并展示，图片不访问外网');
    await panel.getByRole('button', { name: '表情包', exact: true }).click();
    assert.equal((await panel.evaluate(() => window.pet.stickers({ type: 'clear-cache' }))).ok, true);
    await panel.getByRole('button', { name: '导入／更新插件', exact: true }).click(); await panel.getByText('表情插件已更新，请查看来源后开启自动选用', { exact: true }).waitFor();
    assert.equal((await state()).localCount, 4); assert.equal(await app.evaluate(() => globalThis.externalFetches), 0);
    await app.close(); app = undefined; await launch();
    await panel.getByRole('button', { name: '查看我的表情（4）', exact: true }).click(); await select('庆祝练习');
    assert.equal(await panel.getByLabel('表情使用场景', { exact: true }).inputValue(), '完成单词学习时，开心庆祝');
    for (const file of files) await fs.unlink(file);
    await panel.getByRole('button', { name: '重新加载', exact: true }).click(); await wait(() => panel.locator('.sticker-large img').evaluate(img => img.complete && img.naturalWidth === 96), '原文件移除后副本可用');
    check('缓存清理、插件更新和重启后保留我的表情；原文件移除后副本仍可离线显示');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')).setSize(800, 620));
    await delay(250); assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await panel.screenshot({ path: path.join(folder, 'small-window.png') });
    await panel.getByRole('button', { name: '删除这张表情', exact: true }).click(); await panel.getByRole('button', { name: '确认删除表情', exact: true }).click();
    await wait(async () => (await state()).localCount === 3, '删除本地表情');
    const removed = items.find(item => item.name === '开心'); assert.equal(await app.evaluate(async ({ net }, image) => (await net.fetch(image)).status, removed.image), 404);
    check('小窗口可滚动且不横向溢出；删除本地表情后撤销其图片地址');
    assert.equal(await app.evaluate(() => globalThis.externalFetches), 0); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors, userDir, model: '本地 SSE 夹具，实际工具路由；本地测试图，不使用用户图片/聊天/模型凭证' }, null, 2));
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
