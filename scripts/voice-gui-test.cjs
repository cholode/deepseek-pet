// 真实 Electron，模拟麦克风 + 本机 HTTP 音频夹具；不使用用户麦克风或真实云端账户。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/voice${packaged ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')); const checks = [], errors = [], audioRequests = [], transcripts = [], chatRequests = []; let app, holdTts = false, heldTts, holdAsr = false, heldAsr, emptyAsr = false, failChat = false;
  const check = label => { checks.push(label); console.log('PASS', label); };
  const wait = async (fn, label) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`等待超时：${label}`); };
  const audio = Buffer.alloc(44 + 16000); audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(16000, 40);
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
      if (req.url === '/v1/audio/speech') {
        const data = JSON.parse(body.toString()); audioRequests.push(data); assert.equal(data.response_format, 'wav');
        if (holdTts) { heldTts = res; return; } res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(audio);
      } else if (req.url === '/v1/audio/transcriptions' || req.url === '/inference') {
        assert.match(req.headers['content-type'], /multipart\/form-data/); assert.ok(body.includes(Buffer.from('RIFF'))); assert.ok(body.includes(Buffer.from('recording.wav'))); transcripts.push({ path: req.url, size: body.length });
        if (holdAsr) { heldAsr = res; return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: emptyAsr ? '   ' : '今日は日本語を勉強します。' }));
      } else if (req.url === '/chat/completions') {
        chatRequests.push(JSON.parse(body.toString()));
        if (failChat) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fixture chat failure' } })); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '一緒に練習しましょう。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      } else { res.writeHead(404); res.end(); }
    } catch (error) { errors.push(error.message); res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const instrument = async page => page.evaluate(() => {
    window.voiceTestTracks = []; const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); window.voiceTestTracks.push(...stream.getTracks()); return stream; };
  });
  const tracksEnded = page => page.evaluate(() => window.voiceTestTracks.every(track => track.readyState === 'ended'));
  try {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel', '--use-fake-device-for-media-stream'] } : { args: [path.resolve('.'), '--panel', '--use-fake-device-for-media-stream'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message))); await app.firstWindow();
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋'); const panel = app.windows().find(p => p.url().includes('page=panel')); await instrument(panel);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    await panel.getByRole('button', { name: '保存对话设置' }).waitFor();
    await panel.getByRole('heading', { name: 'TTS 试听', exact: true }).waitFor();
    assert.equal(await panel.getByLabel('试听文字', { exact: true }).inputValue(), '这是我的声音');
    const defaults = await panel.evaluate(async () => (await window.pet.voice({ type: 'state' })).state);
    assert.equal(defaults.config.tts.enabled, false); assert.equal(defaults.config.asr.enabled, false);
    const forbidden = await panel.evaluate(async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); return false; } catch { return true; } }); assert.equal(forbidden, true);
    check('默认关闭语音，未发起录音时拒绝麦克风访问');
    await panel.getByLabel('朗读来源', { exact: true }).selectOption('cloud'); await panel.getByLabel('朗读 API Key', { exact: true }).fill('fixture-tts-cloud-secret');
    await panel.getByLabel('识别来源', { exact: true }).selectOption('cloud'); await panel.getByLabel('识别 API Key', { exact: true }).fill('fixture-asr-cloud-secret');
    await panel.getByRole('button', { name: '保存对话设置' }).click(); await wait(async () => (await panel.evaluate(async () => (await window.pet.voice({ type: 'state' })).state)).hasSecrets.asrCloud, '云端设置保存');
    assert.ok(!(await fs.readFile(path.join(userDir, 'conversation-settings.json'), 'utf8')).includes('fixture-tts-cloud-secret'));
    await wait(async () => (await panel.getByLabel('朗读 API Key', { exact: true }).inputValue()) === '', '保存后清空密钥输入框'); check('云端来源可选，独立语音密钥经真实系统加密保存并清空输入框');
    await panel.getByLabel('朗读来源', { exact: true }).selectOption('local'); await panel.getByLabel('本地朗读方式', { exact: true }).selectOption('http');
    await panel.getByLabel('朗读接口地址', { exact: true }).fill(`${base}/v1/audio/speech`); await panel.getByLabel('朗读模型', { exact: true }).fill('fixture-tts'); await panel.getByLabel('声音 ID', { exact: true }).fill('fixture-voice');
    await panel.getByLabel('识别来源', { exact: true }).selectOption('local'); await panel.getByLabel('启用语音输入', { exact: true }).check(); await panel.getByLabel('识别接口地址', { exact: true }).fill(`${base}/v1/audio/transcriptions`); await panel.getByLabel('识别模型', { exact: true }).fill('fixture-asr'); await panel.getByLabel('识别语言', { exact: true }).selectOption('ja');
    await panel.getByRole('button', { name: '保存对话设置' }).click(); await wait(async () => await panel.getByRole('button', { name: '试听声音', exact: true }).isEnabled(), '本地设置保存');
    await panel.getByRole('button', { name: '试听声音', exact: true }).click(); await wait(() => audioRequests.length === 1, '试听请求'); await panel.getByText('试听结束', { exact: true }).waitFor(); assert.equal(audioRequests[0].input, '这是我的声音'); check('默认句子正确，未开启自动朗读也能完成本地 HTTP 合成与音频播放');
    await panel.getByLabel('试听文字', { exact: true }).fill('   '); assert.equal(await panel.getByRole('button', { name: '试听声音', exact: true }).isEnabled(), false);
    await panel.getByLabel('试听文字', { exact: true }).fill('这是自定义试听。こんにちは。'); await panel.getByRole('button', { name: '试听声音', exact: true }).click(); await wait(() => audioRequests.length === 3, '自定义试听请求'); await panel.getByText('试听结束', { exact: true }).waitFor();
    assert.deepEqual(audioRequests.slice(1).map(r => r.input), ['这是自定义试听。', 'こんにちは。']); check('自定义文字逐句传给 TTS 并播放，空白句子不能提交');
    holdTts = true; await panel.getByRole('button', { name: '试听声音', exact: true }).click(); await wait(() => Boolean(heldTts), '等待中的试听');
    await panel.getByRole('button', { name: '停止试听', exact: true }).click(); await wait(() => heldTts.destroyed, '停止试听中断请求'); await panel.getByText('已停止试听', { exact: true }).waitFor(); holdTts = false; heldTts = undefined;
    check('试听期间停止按钮可用并取消网络请求');
    await panel.getByRole('region', { name: 'TTS 试听', exact: true }).screenshot({ path: path.join(folder, 'tts-preview.png') });
    await panel.getByLabel('自动朗读回复', { exact: true }).check(); await panel.getByRole('button', { name: '保存对话设置' }).click(); await wait(async () => (await panel.evaluate(async () => (await window.pet.voice({ type: 'state' })).state)).config.tts.enabled, '开启自动朗读');
    await app.evaluate(({ BrowserWindow }) => { const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')); pet.webContents.send('companion-presentation', { id: 'silent-reminder', phase: 'complete', text: '这是一条静默提醒', emotion: 'calm', source: 'initiative', speech: { enabled: false, voice: '', rate: 1, volume: 0.8 } }); });
    await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(audioRequests.length, 4); check('明确静默的后台提醒不触发 TTS');
    await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor();
    await panel.getByRole('button', { name: /结束录音/ }).click(); await panel.getByLabel('识别测试结果').waitFor(); assert.equal(await panel.getByLabel('识别测试结果').innerText(), '今日は日本語を勉強します。'); assert.ok(await tracksEnded(panel));
    assert.equal(chatRequests.length, 0); assert.equal((await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state)).data.events.length, 0);
    check('AudioWorklet 录音转 WAV 上传成功，独立识别测试只显示文字、不发送聊天并释放麦克风');
    await panel.screenshot({ path: path.join(folder, 'conversation-settings.png'), fullPage: true, animations: 'disabled' });
    await panel.getByLabel('本地识别协议', { exact: true }).selectOption('whisper-cpp'); assert.equal(await panel.getByLabel('识别接口地址', { exact: true }).inputValue(), `${base}/inference`); await panel.getByRole('button', { name: '保存对话设置' }).click();
    await panel.getByRole('button', { name: '和她聊天', exact: true }).click(); await panel.getByLabel('对大肥鱼说').fill('原有草稿');
    assert.equal(await panel.getByRole('button', { name: '语音输入', exact: true }).isEnabled(), false); check('聊天模型未就绪时不开放自动发送录音，独立识别测试仍可使用');
    await panel.evaluate(async base => { const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config; config.enabled = true; config.model.baseUrl = base; config.model.model = 'fixture-chat'; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw new Error(result.message); }, base);
    await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor(); await panel.getByRole('button', { name: /结束录音/ }).click();
    await panel.locator('.companion-message.pet').getByText('一緒に練習しましょう。', { exact: true }).waitFor();
    assert.equal(await panel.getByLabel('对大肥鱼说').inputValue(), '原有草稿'); assert.equal(transcripts.at(-1).path, '/inference');
    assert.deepEqual((await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state)).data.events.filter(e => e.actor === 'user').map(e => e.text), ['今日は日本語を勉強します。']);
    assert.equal(chatRequests.length, 1); assert.equal(chatRequests[0].messages.at(-1).content, '今日は日本語を勉強します。'); await wait(() => audioRequests.length === 5, '语音聊天回复朗读'); check('小屋语音结束后自动发送一次并收到回复，原草稿保留且未交给模型');
    await panel.screenshot({ path: path.join(folder, 'voice-auto-send.png'), fullPage: true, animations: 'disabled' });
    await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音/ }).waitFor(); await panel.getByRole('button', { name: '共同记忆', exact: true }).click(); await wait(() => tracksEnded(panel), '切页停止麦克风'); assert.equal(transcripts.length, 2); assert.equal(chatRequests.length, 1); check('切换页面自动取消录音，不上传或发送未结束的录音');
    await panel.getByRole('button', { name: '和她聊天', exact: true }).click(); holdAsr = true;
    await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor(); await panel.getByRole('button', { name: /结束录音/ }).click(); await wait(() => Boolean(heldAsr), '等待识别');
    await panel.getByRole('button', { name: '取消识别', exact: true }).click(); await wait(() => heldAsr.destroyed, '取消识别请求'); heldAsr.end(JSON.stringify({ text: '不应发送的迟到结果' })); holdAsr = false;
    assert.equal(chatRequests.length, 1); assert.ok(await tracksEnded(panel)); check('取消识别中断请求，迟到结果不自动发送');
    emptyAsr = true; await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor(); await panel.getByRole('button', { name: /结束录音/ }).click();
    await panel.locator('.voice-input [role="status"]').filter({ hasText: '没有识别到文字' }).waitFor(); assert.equal(chatRequests.length, 1); emptyAsr = false; check('空白识别结果显示错误，不发送空消息');
    await panel.getByLabel('对大肥鱼说').fill('一緒に練習しよう'); await panel.getByRole('button', { name: '发送', exact: true }).click(); await wait(() => audioRequests.length === 6, '回复自动朗读'); assert.equal(audioRequests.at(-1).input, '一緒に練習しましょう。'); check('实际聊天完整回复自动进入新 TTS 通道，流式片段不重复朗读');
    holdTts = true; await panel.getByLabel('对大肥鱼说').fill('再说一次'); await panel.getByRole('button', { name: '发送', exact: true }).click(); await wait(() => Boolean(heldTts), '等待中的 TTS'); await panel.getByRole('button', { name: '停止思考与朗读', exact: true }).click(); await wait(() => heldTts.destroyed, '取消网络合成'); holdTts = false; check('停止按钮中断进行中的 TTS HTTP 请求');
    await app.evaluate(({ screen, ipcMain }) => { globalThis.voicePointer = { x: -9000, y: -9000 }; screen.getCursorScreenPoint = () => globalThis.voicePointer; ipcMain.on('hit-regions', (_e, regions) => { globalThis.voiceRegions = regions; }); });
    await wait(() => app.evaluate(() => Boolean(globalThis.voiceRegions?.length)), '命中区域');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=pet')); const r = globalThis.voiceRegions[0]; const b = w.getBounds(); globalThis.voicePointer = { x: Math.round(b.x + r.x + r.width / 2), y: Math.round(b.y + r.y + r.height / 2) }; });
    await wait(() => app.windows().some(p => p.url().includes('page=quick-chat')), '快捷聊天'); const chat = app.windows().find(p => p.url().includes('page=quick-chat')); await instrument(chat);
    await chat.getByLabel('和大肥鱼聊天').fill('快捷聊天原草稿'); const beforeQuickVoice = chatRequests.length;
    await chat.getByRole('button', { name: '语音输入', exact: true }).click(); await chat.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor(); await chat.getByRole('button', { name: /结束录音/ }).click();
    await wait(async () => (await chat.evaluate(async () => (await window.pet.quickChat({ type: 'state' })).state)).reply === '一緒に練習しましょう。' && await chat.getByRole('button', { name: '语音输入', exact: true }).isEnabled() && chatRequests.length > beforeQuickVoice, '快捷语音自动发送并回复');
    assert.equal(chatRequests.length, beforeQuickVoice + 1); assert.equal(chatRequests.at(-1).messages.at(-1).content, '今日は日本語を勉強します。'); assert.equal(await chat.getByLabel('和大肥鱼聊天').inputValue(), '快捷聊天原草稿'); check('桌面快捷聊天识别后自动发送一次，保留键盘草稿并收到回复');
    await chat.screenshot({ path: path.join(folder, 'quick-chat.png'), animations: 'disabled' });
    failChat = true; await chat.getByRole('button', { name: '语音输入', exact: true }).click(); await chat.getByRole('button', { name: /结束录音 [1-9]/ }).waitFor(); await chat.getByRole('button', { name: /结束录音/ }).click();
    await chat.locator('.quick-error').filter({ hasText: '识别结果：今日は日本語を勉強します。' }).waitFor(); assert.equal(await chat.getByLabel('和大肥鱼聊天').inputValue(), '快捷聊天原草稿'); failChat = false; check('聊天请求失败明确显示错误及转写内容，不覆盖已有草稿');
    const validVoiceConfig = await panel.evaluate(async () => (await window.pet.voice({ type: 'state' })).state.config);
    await panel.evaluate(async () => { const { state } = await window.pet.voice({ type: 'state' }); state.config.asr.localProtocol = 'compatible'; state.config.asr.local.model = ''; const r = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!r.ok) throw new Error(r.message); });
    await chat.getByRole('button', { name: '语音输入', exact: true }).click();
    await wait(async () => (await chat.locator('.quick-voice-status').innerText()).includes('识别尚未配置'));
    assert.equal(await chat.locator('.quick-voice-status').isVisible(), true);
    const statusBox = await chat.locator('.quick-voice-status').boundingBox(); assert.ok(statusBox && statusBox.y >= 0 && statusBox.y + statusBox.height <= await chat.evaluate(() => innerHeight));
    await chat.screenshot({ path: path.join(folder, 'asr-error-visible.png'), animations: 'disabled' }); check('识别配置缺失在录音前报错，快捷聊天显示可见提示而非仅悬停文本');
    await panel.evaluate(async config => { const r = await window.pet.voice({ type: 'configure', config, secrets: {} }); if (!r.ok) throw new Error(r.message); }, validVoiceConfig);
    const beforeDismiss = { transcripts: transcripts.length, chats: chatRequests.length };
    await chat.getByRole('button', { name: '语音输入', exact: true }).click(); await chat.getByRole('button', { name: /结束录音/ }).waitFor(); await chat.getByLabel('和大肥鱼聊天').press('Escape'); await wait(() => tracksEnded(chat), '收起释放麦克风'); assert.equal(transcripts.length, beforeDismiss.transcripts); assert.equal(chatRequests.length, beforeDismiss.chats); check('Esc 收起快捷聊天立即停止麦克风，不上传或发送未结束录音');
    assert.deepEqual(errors, []); check('无渲染或服务协议错误');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, audioRequests: audioRequests.length, transcripts, chatRequests: chatRequests.length, userDir, provider: '模拟麦克风、本机 HTTP 音频夹具、真实 Electron safeStorage；未调用真实云端语音或本地模型' }, null, 2));
  } catch (error) { if (app) { for (const page of app.windows()) if (page.url().includes('page=panel')) await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => {}); } throw error; }
  finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
