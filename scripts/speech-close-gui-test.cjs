// 独立 userData、生成的 GIF 与本机 SSE；真实验证关闭按钮始终可见、可点击，不依赖滚动状态。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const sharp = require('sharp');

(async () => {
  const folder = path.resolve(`test-results/speech-close${process.env.PET_TEST_EXECUTABLE ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')); const checks = [], errors = [];
  const image = path.join(userDir, '测试表情.gif');
  await sharp(Buffer.concat([Buffer.alloc(180 * 180 * 3, 60), Buffer.alloc(180 * 180 * 3, 200)]), { raw: { width: 180, height: 360, channels: 3, pageHeight: 180 } }).gif({ loop: 0, delay: [200, 200] }).toFile(image);
  let app, panel, reply = '', streaming = false, held;
  const delta = (text, done = false) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: done ? 'stop' : null }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`;
  const server = http.createServer(async (req, res) => { for await (const _part of req) { /* 消费请求体，不记录用户凭证 */ } res.writeHead(200, { 'Content-Type': 'text/event-stream' }); if (streaming) { held = res; res.write(delta(reply)); } else res.end(delta(reply, true)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wait = async (fn, label) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 75)); } throw Error(`等待超时：${label}`); };
  const check = text => { checks.push(text); console.log('PASS', text); };
  const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=speech-bubble'))?.isVisible());
  const closeButton = async bubble => {
    const button = bubble.getByRole('button', { name: '关闭回复', exact: true }); await button.waitFor({ timeout: 5000 });
    assert.ok(await button.evaluate(el => { const b = el.getBoundingClientRect(); return b.width >= 24 && b.height >= 24 && b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), '关闭按钮必须在原生窗口内、可命中且不被文字/图片/尖角遮挡');
    return button;
  };
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋'); panel = app.windows().find(p => p.url().includes('page=panel'));
    await app.evaluate(({ dialog }, image) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] }); }, image);
    await panel.evaluate(async url => {
      const imported = await window.pet.stickers({ type: 'import-images' }); if (!imported.ok) throw Error(imported.message);
      const boot = await window.pet.bootstrap(); await window.pet.saveSettings({ ...boot.settings, paused: true, bubbles: true });
      const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config;
      config.enabled = true; config.model.model = 'close-fixture'; config.model.baseUrl = url; config.memory.automatic = false; config.mood.enabled = false; config.speech.enabled = false; config.initiative.enabled = false;
      const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw Error(saved.message);
    }, `http://127.0.0.1:${server.address().port}/v1`);
    // 图片由正式的“每次回复都发送”流程追加；模型自行拼接的图片地址会按设计剔除。
    for (const [name, text] of [['short', '晚安。'], ['sticker', '嘿，被你亲得冒泡泡了。不过快一点了哦，明天不用早起吗？'], ['long', Array.from({ length: 50 }, (_, i) => `第 ${i + 1} 句，练习日语时也可以随时收起回复。`).join('\n\n')]]) {
      await panel.evaluate(async enabled => {
        const { state } = await window.pet.stickers({ type: 'state' });
        const saved = await window.pet.stickers({ type: 'configure', settings: { ...state.settings, enabled, offline: true, frequency: 'always', packs: ['我的表情'] } });
        if (!saved.ok) throw Error(saved.message);
      }, name !== 'short');
      reply = text; const result = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '请回复测试内容' })); assert.ok(result.ok, result.message);
      await wait(visible, '气泡可见'); const bubble = app.windows().find(p => p.url().includes('page=speech-bubble'));
      if (name !== 'short') await wait(() => bubble.locator('img.chat-sticker').evaluate(img => img.complete && img.naturalWidth === 180), 'GIF 加载完成');
      const button = await closeButton(bubble), before = await button.boundingBox();
      await bubble.locator('.speech-content').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
      const after = await (await closeButton(bubble)).boundingBox(); assert.equal(after.x, before.x); assert.equal(after.y, before.y);
      await bubble.screenshot({ path: path.join(folder, `${name}.png`), omitBackground: true });
      await button.click(); await wait(async () => !await visible(), '点击关闭');
      check(`${name}：关闭键始终在右上角，图片加载与滚动不移位，真实点击可收起`);
    }
    streaming = true; reply = '还在说…'; const pending = panel.evaluate(() => window.pet.companion({ type: 'chat', text: '测试生成中关闭' }));
    await wait(() => Boolean(held), '流式回复'); await wait(visible, '流式气泡'); const bubble = app.windows().find(p => p.url().includes('page=speech-bubble'));
    await (await closeButton(bubble)).click(); await wait(async () => !await visible(), '流式关闭'); held.end(delta('这条回复继续结束。', true)); assert.ok((await pending).ok); assert.equal(await visible(), false);
    check('生成中也可关闭，同一回复的后续流式内容和完成通知不会重弹');
    assert.deepEqual(errors, []); await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, model: '本机 SSE + 生成 GIF，真实 Electron 关闭按钮；未使用用户聊天、凭证或语音' }, null, 2));
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
