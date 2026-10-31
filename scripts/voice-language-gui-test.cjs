// 隔离资料目录的真实 Electron；模型使用协议夹具。可指定真实 VOICEVOX 目录验证本机合成。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const realVoicevox = process.env.PET_VOICEVOX_DIRECTORY || '';
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const folder = path.resolve(`test-results/voice-language${packaged ? '-packaged' : ''}${realVoicevox ? '-real' : ''}`);
  await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')); const checks = [], errors = [], japanese = [], queryTimeline = [];
  const realBase = 'http://127.0.0.1:50031';
  let app; let prompts = []; let hold = false, held;
  const check = label => { checks.push(label); console.log('PASS', label); };
  const wait = async (fn, label, ms = 60000) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`等待超时：${label}`); };
  const wav = Buffer.alloc(44 + 16000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  const reply = '<voice lang="zh">今天练习：</voice><voice lang="ja">先生</voice><voice lang="zh">，意思是老师。</voice>';
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks).toString(); const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/version') return res.end('"fixture"');
    if (url.pathname === '/speakers') return res.end(JSON.stringify([{ name: '雨晴はう', styles: [{ name: 'ノーマル', id: 10, type: 'talk' }] }]));
    if (url.pathname === '/audio_query') { japanese.push(url.searchParams.get('text')); queryTimeline.push({ text: url.searchParams.get('text'), at: Date.now() }); return res.end(JSON.stringify({ accent_phrases: [], speedScale: 1 })); }
    if (url.pathname === '/synthesis') { if (hold) { held = res; return; } res.setHeader('Content-Type', 'audio/wav'); return res.end(wav); }
    if (url.pathname === '/chat/completions') {
      prompts = JSON.parse(body).messages; res.setHeader('Content-Type', 'text/event-stream');
      // 标签被拆成多个网络片段，真实走流式解析及展示。
      for (const content of [reply.slice(0, 7), reply.slice(7, 29), reply.slice(29)]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const observe = async page => page.evaluate(() => {
    window.voiceLanguageLog = [];
    const synthesis = window.speechSynthesis; const speak = synthesis.speak.bind(synthesis);
    // 包装实际结束回调：先记录结束，再推进队列，避免微任务先于其他监听器造成假重叠。
    synthesis.speak = utterance => { window.voiceLanguageLog.push({ type: 'system-start', at: Date.now(), text: utterance.text, voice: utterance.voice?.name, language: utterance.lang }); const ended = utterance.onend; utterance.onend = function (event) { window.voiceLanguageLog.push({ type: 'system-end', at: Date.now() }); ended?.call(this, event); }; speak(utterance); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.voiceLanguageLog.push({ type: 'audio-start', at: Date.now() }); this.addEventListener('ended', () => window.voiceLanguageLog.push({ type: 'audio-end', at: Date.now(), duration: this.duration }), { once: true, capture: true }); return play.call(this); };
  });
  try {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await wait(() => app.windows().some(page => page.url().includes('page=panel')), '小屋');
    const panel = app.windows().find(page => page.url().includes('page=panel')); const pet = app.windows().find(page => page.url().includes('page=pet'));
    await observe(panel); await observe(pet);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    await panel.getByLabel('声音分配', { exact: true }).selectOption('language');
    assert.equal(await panel.getByLabel('朗读来源', { exact: true }).count(), 0);
    await panel.getByLabel('VOICEVOX 地址', { exact: true }).fill(realVoicevox ? realBase : base);
    await panel.getByLabel('日语合成设备', { exact: true }).selectOption(realVoicevox ? 'gpu' : 'cpu');
    await panel.getByLabel('CPU 合成线程数', { exact: true }).fill('8');
    await panel.getByLabel('自动朗读回复', { exact: true }).check();
    await panel.getByRole('button', { name: '保存对话设置', exact: true }).click();
    await wait(() => panel.getByRole('button', { name: '试听声音', exact: true }).isEnabled(), '保存');
    if (realVoicevox) {
      await panel.evaluate(async directory => { const { state } = await window.pet.voice({ type: 'state' }); state.config.tts.voicevox.directory = directory; state.config.tts.voicevox.autoStart = true; const result = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!result.ok) throw new Error(result.message); }, realVoicevox);
      // 重新挂载设置组件，确保显示的是真实已保存配置。
      await panel.getByRole('button', { name: '和她聊天', exact: true }).click(); await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    }
    await panel.getByRole('button', { name: '检查日语声音', exact: true }).click();
    await wait(async () => { const note = await panel.locator('.conversation-settings .notice').innerText(); if (note === '正在连接 VOICEVOX…') return false; assert.match(note, /已连接 VOICEVOX：雨晴はう/); return true; }, '检查实际日语服务');
    check(realVoicevox ? '按需启动真实 VOICEVOX 并确认雨晴はう的普通音色' : '保存中日分声设置并确认角色列表');
    await panel.getByRole('button', { name: '试听中日切换', exact: true }).click(); await panel.getByText('试听结束', { exact: true }).waitFor({ timeout: 60000 });
    const previewLog = await panel.evaluate(() => window.voiceLanguageLog);
    assert.deepEqual(previewLog.map(item => item.type), ['system-start', 'system-end', 'audio-start', 'audio-end', 'audio-start', 'audio-end', 'system-start', 'system-end']);
    assert.match(previewLog[0].voice, /Microsoft/); assert.match(previewLog[0].language, /^zh/);
    check('真实微软中文 → 两句日语 WAV → 微软中文依次播放完毕，无声音重叠');
    if (!realVoicevox) {
      assert.equal(queryTimeline[0].text, 'こんにちは。'); assert.ok(queryTimeline[0].at < previewLog[1].at);
      assert.ok(queryTimeline[1].at < previewLog[3].at);
      check('后句在前句播放结束前开始合成，中文与日语切换也有预取');
    }
    await panel.getByLabel('试听语言', { exact: true }).selectOption('ja'); await panel.getByLabel('试听文字', { exact: true }).fill('こんにちは。これが私の声です。');
    await panel.getByRole('button', { name: '试听声音', exact: true }).click(); await panel.getByText('试听结束', { exact: true }).waitFor({ timeout: 60000 }); check('自定义日语试听正常');
    await panel.screenshot({ path: path.join(folder, 'settings.png'), fullPage: true });
    await panel.evaluate(async base => { const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config; config.enabled = true; config.model.baseUrl = base; config.model.model = 'language-fixture'; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw new Error(result.message); }, base);
    await panel.getByRole('button', { name: '和她聊天', exact: true }).click(); await panel.getByLabel('对大肥鱼说').fill('教我先生这个日语词'); await panel.getByRole('button', { name: '发送', exact: true }).click();
    await wait(async () => (await pet.evaluate(() => window.voiceLanguageLog)).filter(item => item.type === 'system-end').length === 2, '聊天中日语音');
    const log = await pet.evaluate(() => window.voiceLanguageLog); assert.deepEqual(log.map(item => item.type), ['system-start', 'system-end', 'audio-start', 'audio-end', 'system-start', 'system-end']);
    assert.match(prompts[0].content, /<voice lang="ja" emotion="happy">/);
    const state = await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state);
    const event = state.data.events.find(item => item.actor === 'pet'); assert.equal(event.text, '今天练习：先生，意思是老师。'); assert.deepEqual(event.speechSegments.map(segment => segment.language), ['zh', 'ja', 'zh']);
    assert.equal((await panel.locator('body').innerText()).includes('<voice'), false);
    if (!realVoicevox) assert.equal(japanese.at(-1), '先生');
    check('模型同次输出标注语言；汉字日语词交给日语引擎；历史与聊天不显示标签');
    await panel.screenshot({ path: path.join(folder, 'chat.png'), fullPage: true });
    if (!realVoicevox) {
      hold = true; await panel.getByLabel('对大肥鱼说').fill('再练一次'); await panel.getByRole('button', { name: '发送', exact: true }).click(); await wait(() => Boolean(held), '合成等待');
      await panel.getByRole('button', { name: '停止思考与朗读', exact: true }).click(); await wait(() => held.destroyed, '取消 VOICEVOX 请求');
      const before = (await pet.evaluate(() => window.voiceLanguageLog)).filter(item => item.type === 'system-start').length;
      await new Promise(resolve => setTimeout(resolve, 500)); assert.equal((await pet.evaluate(() => window.voiceLanguageLog)).filter(item => item.type === 'system-start').length, before); check('停止取消日语合成并丢弃后续中文段落');
    }
    assert.deepEqual(errors, []);
    await app.close(); app = undefined;
    if (realVoicevox) { await wait(async () => { try { await fetch(`${realBase}/version`, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, '退出关闭自启引擎'); check('退出桌宠后自启的 VOICEVOX 引擎已关闭'); }
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, previewLog, queryTimeline, chatLog: log, providers: { model: 'local fixture', chinese: 'real Windows Microsoft voice', japanese: realVoicevox ? 'real VOICEVOX 雨晴はう GPU / 8 threads' : 'local WAV fixture' } }, null, 2));
  } catch (error) {
    const panel = app?.windows().find(page => page.url().includes('page=panel'));
    if (panel) { console.error('UI status:', await panel.getByRole('status').allTextContents().catch(() => [])); await panel.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }).catch(() => {}); }
    throw error;
  } finally { if (app) await app.close().catch(() => {}); held?.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
