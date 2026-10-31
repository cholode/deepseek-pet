// 隔离用户历史；真实已配置模型 + 本机三月七，测发送到真实音频 playing 事件。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
require('tsx/cjs');
const { speechPlan } = require('../src/shared/voice.ts');
(async () => {
  const folder = path.resolve(`test-results/${process.env.PET_STREAM_TEST ? 'streaming-real' : 'greeting-latency'}${process.env.PET_TEST_EXECUTABLE ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const original = path.join(process.env.APPDATA, 'deepblue-desktop-pet'), userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const originalData = JSON.parse(await fs.readFile(path.join(original, 'companion.json'), 'utf8'));
  const config = originalData.config; config.qq.enabled = false; config.mcp.enabled = false; config.initiative.enabled = false;
  // 只保留配置，不把测试问候写进真实用户的记忆或学习历史。
  config.memory.automatic = false; config.mood.enabled = false;
  for (const name of ['companion-secrets.json', 'Local State']) await fs.copyFile(path.join(original, name), path.join(userDir, name));
  await fs.cp(path.join(original, 'stickers'), path.join(userDir, 'stickers'), { recursive: true });
  const settings = JSON.parse(await fs.readFile(path.join(original, 'conversation-settings.json'), 'utf8'));
  let firstSynthesisAt; let proxy;
  if (process.env.PET_STREAM_TEST) {
    // 只记录本机请求起点，仍由真实推理池合成；不记录模型凭证或替换声音。
    proxy = http.createServer((request, response) => {
      if (request.url === '/v1/audio/speech') firstSynthesisAt ??= Date.now();
      const upstream = http.request({ hostname: '127.0.0.1', port: 9884, path: request.url, method: request.method, headers: request.headers }, result => {
        response.writeHead(result.statusCode, result.headers); result.pipe(response);
      });
      upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  }
  settings.sealed = {}; settings.config.asr.enabled = false; settings.config.tts.gptSovits.url = `http://127.0.0.1:${proxy?.address().port ?? 9884}`;
  await fs.writeFile(path.join(userDir, 'conversation-settings.json'), JSON.stringify(settings));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app; const started = Date.now(), records = [];
  const wait = async (test, label, ms = 120000) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error(`等待超时：${label}`); };
  try {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋');
    const panel = app.windows().find(p => p.url().includes('page=panel')), pet = app.windows().find(p => p.url().includes('page=pet'));
    await panel.evaluate(() => { window.finishedSpeech = []; window.pet.onPresentation(value => { if (value?.phase === 'complete') window.finishedSpeech.push(value.id); }); });
    await pet.evaluate(() => {
      window.playEvents = []; window.modelCompleteAt = undefined;
      window.pet.onPresentation(value => { if (value?.phase === 'complete') window.modelCompleteAt = Date.now(); });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { this.addEventListener('playing', () => window.playEvents.push({ event: 'playing', at: Date.now() }), { once: true }); this.addEventListener('ended', () => window.playEvents.push({ event: 'ended', at: Date.now() }), { once: true }); return play.call(this); };
    });
    await wait(async () => { const { state } = await panel.evaluate(() => window.pet.voice({ type: 'state' })); if (state.error) throw Error(state.error); return !state.preparing; }, '本地预热');
    const preparedMs = Date.now() - started;
    assert.equal((await pet.evaluate(() => window.playEvents)).length, 0, '预热不能播放声音');
    console.log('PASS 启动即预热，未发送聊天、未播放声音，准备耗时', preparedMs);
    const configured = await panel.evaluate(config => window.pet.companion({ type: 'configure', config }), config); assert.ok(configured.ok, configured.message);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    for (const text of process.env.PET_STREAM_TEST ? ['请直接用中文介绍十个日语学习小习惯，每个用一句短句解释，不列标题不调用工具。第一句先说“准备好啦。”，之后接着介绍，十句都要写完整。'] : ['上午好', '你好呀', '晚上好']) {
      await pet.evaluate(() => { window.playEvents = []; window.modelCompleteAt = undefined; }); firstSynthesisAt = undefined;
      await panel.getByLabel('对大肥鱼说').fill(text); const sentAt = Date.now(); await panel.getByRole('button', { name: '发送', exact: true }).click();
      await wait(async () => (await pet.evaluate(() => window.playEvents)).some(e => e.event === 'playing'), '首音频');
      const playing = (await pet.evaluate(() => window.playEvents)).find(e => e.event === 'playing');
      await wait(async () => !(await panel.evaluate(() => window.pet.companion({ type: 'state' }))).state.busy, '本轮完成');
      const state = (await panel.evaluate(() => window.pet.companion({ type: 'state', forExport: true }))).state;
      const user = state.data.events.filter(e => e.actor === 'user').at(-1), reply = state.data.events.filter(e => e.actor === 'pet').at(-1);
      assert.ok(reply.text.includes('petsticker://')); assert.ok(reply.speechSegments.some(s => s.emotion));
      const modelCompleteAt = await pet.evaluate(() => window.modelCompleteAt);
      records.push({ text, reply: reply.text, textReadyMs: reply.at - user.at, firstAudioMs: playing.at - user.at, clickToAudioMs: playing.at - sentAt, synthesisStartMs: firstSynthesisAt && firstSynthesisAt - user.at, synthesisBeforeModelComplete: firstSynthesisAt && firstSynthesisAt < modelCompleteAt, audioBeforeModelComplete: playing.at < modelCompleteAt });
      if (proxy) assert.ok(firstSynthesisAt < modelCompleteAt, '真实模型仍在流式输出时首句已进入真实 TTS');
      console.log('PASS', JSON.stringify(records.at(-1)));
      // 等本轮整段播放退出，避免用下一轮的旧音频事件测量。
      const expected = speechPlan(reply.text, reply.speechSegments).length;
      await wait(async () => (await pet.evaluate(() => window.playEvents)).filter(e => e.event === 'ended').length === expected, '声音结束');
    }
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ preparedMs, records, model: config.model.model, realModel: true, realAudio: true, isolatedHistory: true }, null, 2));
    await panel.screenshot({ path: path.join(folder, 'chat.png'), fullPage: true });
  } finally {
    await app?.close().catch(() => {});
    proxy?.close();
    for (const name of ['companion-secrets.json', 'Local State']) await fs.rm(path.join(userDir, name), { force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
