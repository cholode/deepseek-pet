// 固定复现用户这条问候，只替代聊天模型；语音可连接本机真实三月七，历史与设置隔离。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const realTts = process.env.PET_REAL_TTS_URL;
  if (realTts && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(realTts)) throw Error('仅接受本机测试语音服务');
  const folder = path.resolve(`test-results/speech-continuity${process.env.PET_TEST_EXECUTABLE ? '-packaged' : ''}`);
  await fs.mkdir(folder, { recursive: true }); const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const requests = [], checks = [], errors = []; let app;
  const check = text => { checks.push(text); console.log('PASS', text); };
  const wait = async (test, label) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error(`等待超时：${label}`); };
  const first = '早上好呀。', second = '今天精神怎么样？', full = first + second;
  const reply = `<voice lang="zh" emotion="happy">${first}</voice><voice lang="zh" emotion="neutral">${second}</voice>`;
  const wav = Buffer.alloc(44 + 16000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  const server = http.createServer(async (req, res) => {
    try {
      const data = []; for await (const chunk of req) data.push(chunk);
      if (req.url === '/v1/audio/speech') {
        const body = JSON.parse(Buffer.concat(data)); requests.push(body);
        let bytes = wav;
        if (realTts) {
          const response = await fetch(new URL('/v1/audio/speech', realTts), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
          if (!response.ok) throw Error(`真实语音 HTTP ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
        }
        await fs.writeFile(path.join(folder, `sentence-${requests.length}.wav`), bytes);
        res.setHeader('Content-Type', 'audio/wav'); return res.end(bytes);
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify({ service: 'deepblue-gpt-sovits', protocol: 1, ready: true, voices: [{ id: 'neutral', name: '中立' }, { id: 'happy', name: '开心' }] }));
      if (req.url === '/chat/completions') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(404).end();
    } catch (error) { errors.push(error.message); res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await wait(() => ['page=panel', 'page=pet'].every(page => app.windows().some(p => p.url().includes(page))), '小屋与桌宠');
    const panel = app.windows().find(p => p.url().includes('page=panel')), pet = app.windows().find(p => p.url().includes('page=pet'));
    await pet.evaluate(() => {
      window.audioEvents = []; window.systemSpeechCount = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.addEventListener('playing', () => window.audioEvents.push('playing'), { once: true });
        this.addEventListener('ended', () => window.audioEvents.push('ended'), { once: true }); return play.call(this);
      };
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = utterance => { window.systemSpeechCount++; speak(utterance); };
    });
    await panel.evaluate(async base => {
      window.finished = []; window.pet.onPresentation(value => { if (value?.phase === 'complete') window.finished.push(value.id); });
      const { state } = await window.pet.voice({ type: 'state' });
      Object.assign(state.config.tts, { enabled: true, mode: 'language', languageChinese: 'configured', localEngine: 'gpt-sovits' });
      Object.assign(state.config.tts.gptSovits, { url: base, japanese: true, autoEmotion: true });
      const saved = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!saved.ok) throw Error(saved.message);
      const companion = await window.pet.companion({ type: 'state' }), config = companion.state.data.config;
      config.enabled = true; config.model.baseUrl = base; config.model.model = 'greeting-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false;
      const updated = await window.pet.companion({ type: 'configure', config }); if (!updated.ok) throw Error(updated.message);
    }, base);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.getByLabel('对大肥鱼说').fill('早上好'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await wait(async () => (await panel.evaluate(() => window.finished)).length === 1, '整条语音播放结束');
    await wait(async () => (await pet.evaluate(() => window.audioEvents)).filter(e => e === 'ended').length === 2, '两句音频结束');
    assert.equal((await panel.evaluate(() => window.pet.voice({ type: 'state' }))).state.error, undefined);
    assert.deepEqual(requests.map(r => [r.input, r.voice, r.language]), [[first, 'happy', 'zh'], [second, 'happy', 'zh']]);
    check('原始 happy → neutral 问候的两句均用三月七 happy 参考音');
    const stored = (await panel.evaluate(() => window.pet.companion({ type: 'state', forExport: true }))).state.data.events.filter(e => e.actor === 'pet');
    assert.equal(stored.length, 1); assert.equal(stored[0].text, full);
    assert.deepEqual(stored[0].speechSegments.map(s => s.emotion), ['happy', 'neutral']);
    assert.equal(await panel.locator('.companion-message.pet').count(), 1);
    assert.deepEqual(await pet.evaluate(() => window.audioEvents), ['playing', 'ended', 'playing', 'ended']);
    assert.equal(await pet.evaluate(() => window.systemSpeechCount), 0);
    check('一条回复、每句只播放一次，无微软声音；原始模型标签保留');
    // 重复完成事件及动作事件都不能再朗读正文。
    await app.evaluate(({ BrowserWindow }, value) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet'));
      const presentation = { ...value, emotion: 'happy', speech: { enabled: true, voice: '', rate: 1, volume: 0.8 } };
      win.webContents.send('companion-presentation', { ...presentation, phase: 'complete' });
      win.webContents.send('companion-presentation', { ...presentation, phase: 'action' });
    }, stored[0]);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(requests.length, 2); assert.equal((await pet.evaluate(() => window.audioEvents)).length, 4);
    check('重复通知和后续动作不触发第二遍播放');
    assert.deepEqual(errors, []);
    await panel.screenshot({ path: path.join(folder, 'chat.png'), fullPage: true });
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, requests, realTts: Boolean(realTts), model: 'fixture', audioEvents: await pet.evaluate(() => window.audioEvents) }, null, 2));
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
