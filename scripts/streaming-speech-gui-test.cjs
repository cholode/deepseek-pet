// 真实 Electron + 可控 SSE/音频夹具，验证模型未结束就合成、首句闸门和两条独立队列。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
(async () => {
  const folder = path.resolve(`test-results/streaming-speech${process.env.PET_TEST_EXECUTABLE ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')), requests = [], checks = [], errors = [];
  let app, model, modelClosed = false;
  const wait = async (test, label) => { const until = Date.now() + 20000; while (Date.now() < until) { if (await test()) return; await new Promise(r => setTimeout(r, 20)); } throw Error(`等待超时：${label}`); };
  const check = text => { checks.push(text); console.log('PASS', text); };
  const wav = Buffer.alloc(44 + 32000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ service: 'deepblue-gpt-sovits', protocol: 1, ready: true, voices: [{ id: 'neutral', name: '中立' }], workers: 2 })); }
    if (req.url === '/v1/audio/speech') { requests.push({ body: JSON.parse(Buffer.concat(chunks)), res }); return; }
    if (req.url === '/chat/completions') { model = res; modelClosed = false; res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders(); return; }
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const delta = content => model.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  const end = () => { modelClosed = true; model.end('data: [DONE]\n\n'); };
  const release = i => { requests[i].res.setHeader('Content-Type', 'audio/wav'); requests[i].res.end(wav); };
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await wait(() => ['page=pet', 'page=panel'].every(part => app.windows().some(p => p.url().includes(part))), '窗口');
    const panel = app.windows().find(p => p.url().includes('page=panel')), pet = app.windows().find(p => p.url().includes('page=pet'));
    await pet.evaluate(() => {
      window.audioEvents = []; const original = HTMLMediaElement.prototype.play; let sequence = 0;
      HTMLMediaElement.prototype.play = function () { const index = sequence++; this.addEventListener('playing', () => window.audioEvents.push({ index, phase: 'playing' }), { once: true }); this.addEventListener('ended', () => window.audioEvents.push({ index, phase: 'ended' }), { once: true }); return original.call(this); };
    });
    await panel.evaluate(async base => {
      const { state } = await window.pet.voice({ type: 'state' }); Object.assign(state.config.tts, { enabled: true, mode: 'language', languageChinese: 'configured', localEngine: 'gpt-sovits' });
      Object.assign(state.config.tts.gptSovits, { url: base, japanese: true, workers: 2 });
      const voice = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!voice.ok) throw Error(voice.message);
      const { state: companion } = await window.pet.companion({ type: 'state' }); const config = companion.data.config;
      config.enabled = true; config.model.baseUrl = base; config.model.model = 'stream-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false;
      const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw Error(saved.message);
    }, base);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    const visible = () => panel.locator('.companion-messages').innerText();
    const send = async text => { model = undefined; await panel.getByLabel('对大肥鱼说').fill(text); await panel.getByRole('button', { name: '发送', exact: true }).click(); await wait(() => model, 'SSE 连接'); };
    await send('流式并发测试');
    delta('<voice lang="zh" emotion="happy">**你好'); await new Promise(r => setTimeout(r, 60)); assert.equal(requests.length, 0);
    delta('**！</voice>'); await wait(() => requests.length === 1, '首句立即合成'); assert.equal(modelClosed, false);
    delta('<voice lang="zh" emotion="neutral">今天练习日语。</voice>'); await wait(() => requests.length === 2, '第二句同时合成');
    assert.equal(requests[0].res.writableEnded, false); assert.equal((await visible()).includes('今天练习'), false);
    check('模型未结束时首句已合成，第二句并发；半标签和半句不合成');
    release(1); await new Promise(r => setTimeout(r, 60)); assert.equal((await pet.evaluate(() => window.audioEvents)).length, 0);
    delta('<voice lang="ja" emotion="neutral">こんにちは'); release(0);
    await wait(async () => (await visible()).includes('こんにちは'), '首句闸门后释放全部缓存文字');
    assert.equal(modelClosed, false); assert.equal(requests.length, 2); assert.equal(await panel.locator('.companion-message.pet').count(), 1);
    assert.equal(await panel.locator('.companion-message.pet strong').innerText(), '你好');
    check('首句播放后，第二句及未完第三句文字独立出现，Markdown 保留且无重复消息');
    delta('！</voice>'); await wait(() => requests.length === 3, '第三句在模型结束前合成'); end();
    await wait(async () => (await visible()).includes('こんにちは！'), '完整文字');
    assert.equal(requests[2].res.writableEnded, false); assert.deepEqual(requests.map(r => [r.body.language, r.body.voice]), [['zh', 'happy'], ['zh', 'happy'], ['ja', 'happy']]);
    check('全文不等待第三句音频；中日声音连贯，合成队列和文字队列独立');
    release(2); await wait(async () => (await pet.evaluate(() => window.audioEvents)).filter(e => e.phase === 'ended').length === 3, '播放完毕');
    assert.deepEqual(await pet.evaluate(() => window.audioEvents), [0, 1, 2].flatMap(index => [{ index, phase: 'playing' }, { index, phase: 'ended' }]));
    assert.equal(requests.length, 3); check('合成乱序完成仍顺序播放，每句一次，模型结束不重读全文');
    await wait(async () => !(await panel.evaluate(() => window.pet.companion({ type: 'state' }))).state.busy, '模型回合完成');
    await send('取消并发测试'); delta('<voice lang="zh">一。</voice><voice lang="zh">二。</voice>'); await wait(() => requests.length === 5, '两条在途语音');
    await panel.getByRole('button', { name: '停止思考与朗读', exact: true }).click(); await wait(() => requests[3].res.destroyed && requests[4].res.destroyed && model.destroyed, '取消模型与所有语音');
    assert.equal((await pet.evaluate(() => window.audioEvents)).length, 6); check('停止同时取消模型流与并发语音，迟到音频不播放');
    await send('语音失败继续显示'); delta('<voice lang="zh">声音暂时失败。</voice>'); await wait(() => requests.length === 6, '失败请求'); requests[5].res.writeHead(500).end();
    await wait(async () => (await panel.evaluate(() => window.pet.voice({ type: 'state' }))).state.error, '显示语音错误');
    delta('<voice lang="zh">文字继续流式显示。</voice>'); end(); await wait(async () => (await visible()).includes('文字继续流式显示。'), '失败后文字继续');
    check('语音失败打开文字闸门，后续模型文字继续流式显示');
    await panel.screenshot({ path: path.join(folder, 'chat.png'), fullPage: true }); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, requests: requests.map(r => r.body), audio: await pet.evaluate(() => window.audioEvents) }, null, 2));
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
