// 使用已配置模型检查真实语言/情绪输出；隔离资料目录，关闭播放与外部工具。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const folder = path.resolve('test-results/speech-model'); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')), original = path.join(process.env.APPDATA, 'deepblue-desktop-pet');
  const { config } = JSON.parse(await fs.readFile(path.join(original, 'companion.json'), 'utf8'));
  for (const name of ['companion-secrets.json', 'Local State']) await fs.copyFile(path.join(original, name), path.join(userDir, name));
  config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.qq.enabled = false; config.mcp.enabled = false; config.speech.enabled = false;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.'), '--panel'], env });
    const deadline = Date.now() + 20000;
    while (!app.windows().some(p => p.url().includes('page=panel'))) { if (Date.now() > deadline) throw Error('小屋未启动'); await new Promise(resolve => setTimeout(resolve, 100)); }
    const panel = app.windows().find(p => p.url().includes('page=panel'));
    const initial = await panel.evaluate(() => window.pet.companion({ type: 'state' })); assert.ok(initial.state.hasSecrets.model, '未能读取隔离的模型凭证');
    await panel.evaluate(async config => {
      const saved = await window.pet.companion({ type: 'configure', config }); if (!saved.ok) throw Error(saved.message);
      await window.pet.companion({ type: 'growth-configure', enabled: false, locked: [] });
      const { state } = await window.pet.voice({ type: 'state' });
      Object.assign(state.config.tts, { enabled: false, mode: 'language', languageChinese: 'configured', localEngine: 'gpt-sovits' });
      Object.assign(state.config.tts.gptSovits, { japanese: true, autoEmotion: true });
      const result = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!result.ok) throw Error(result.message);
    }, config);
    const began = Date.now();
    const response = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '这是内部语音测试。请只用三句简短的话：先开心地用中文鼓励我，再读日语「私は学生です。」，最后用中文解释它的意思。不要使用工具。' }));
    const reply = response.state.data.events.filter(e => e.actor === 'pet').at(-1);
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ ok: response.ok, error: response.message, model: config.model.model, elapsedMs: Date.now() - began, reply, notice: response.state.notice, realModel: true, playedAudio: false }, null, 2));
    assert.ok(response.ok, response.message); assert.ok(reply?.speechSegments?.some(s => s.language === 'ja' && s.text.includes('私は学生です')));
    assert.ok(reply.speechSegments.some(s => s.language === 'zh' && s.emotion === 'happy'));
    assert.ok(reply.speechSegments.every(s => s.emotion)); assert.equal(reply.text.includes('<voice'), false);
    console.log('PASS 真实聊天模型在同次正文中输出中文、日文和逐句情绪；净正文与历史分段正确');
  } finally {
    await app?.close().catch(() => {});
    for (const name of ['companion-secrets.json', 'Local State']) await fs.rm(path.join(userDir, name), { force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
