// 已知合成音频 -> Chromium 模拟麦克风 -> 真实本地 Whisper；不使用用户物理麦克风或云端账户。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function pcmWav(buffer) {
  let data;
  for (let i = 12; i + 8 <= buffer.length;) { const size = buffer.readUInt32LE(i + 4); if (buffer.toString('ascii', i, i + 4) === 'data') { data = buffer.subarray(i + 8, i + 8 + size); break; } i += 8 + size + (size % 2); }
  if (!data) throw new Error('样本没有 PCM 数据');
  const out = Buffer.alloc(44 + data.length); out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(data.length, 40); data.copy(out, 44); return out;
}
(async () => {
  const directory = process.env.PET_WHISPER_DIRECTORY, modelPath = process.env.PET_WHISPER_MODEL;
  if (!directory || !modelPath) throw new Error('需指定真实 Whisper 引擎与模型路径');
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE); const folder = path.resolve(`test-results/asr-real${packaged ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')); const errors = [], checks = [], results = [];
  const sample = path.resolve('test-results/asr-samples/zh.wav'); const chinese = pcmWav(await fs.readFile(sample));
  const japanese = pcmWav(await fs.readFile('test-results/asr-samples/ja.wav'));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const wait = async (fn, label) => { const end = Date.now() + 90000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error(`等待超时：${label}`); };
  const check = label => { checks.push(label); console.log('PASS', label); };
  let app;
  try {
    const args = ['--panel', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${sample}`];
    app = await electron.launch({ ...(packaged ? { executablePath: process.env.PET_TEST_EXECUTABLE, args } : { args: [path.resolve('.'), ...args] }), env });
    app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
    await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋'); const panel = app.windows().find(p => p.url().includes('page=panel'));
    await panel.evaluate(async ({ directory, modelPath }) => {
      const { state } = await window.pet.voice({ type: 'state' }); const config = state.config;
      config.asr.enabled = true; config.asr.source = 'local'; config.asr.localProtocol = 'whisper-cpp'; config.asr.local.url = 'http://127.0.0.1:18080/inference'; config.asr.language = '';
      config.asr.whisper = { directory, modelPath, autoStart: true, cpuThreads: 8 };
      const result = await window.pet.voice({ type: 'configure', config, secrets: {} }); if (!result.ok) throw new Error(result.message);
    }, { directory, modelPath });
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    await panel.getByRole('button', { name: '检查识别服务', exact: true }).click();
    await wait(async () => { const note = await panel.locator('.conversation-settings .notice').innerText(); if (note.startsWith('正在连接')) return false; assert.match(note, /本地识别引擎已就绪/); return true; }, '真实引擎启动'); check('选择引擎和模型后自动启动，健康检查通过');
    await panel.getByRole('button', { name: '语音输入', exact: true }).click(); await panel.getByRole('button', { name: /结束录音/ }).waitFor();
    await pause(chinese.length / 32 + 500); const started = Date.now();
    await panel.getByRole('button', { name: /结束录音/ }).click(); await panel.getByLabel('识别测试结果').waitFor({ timeout: 90000 });
    const zh = await panel.getByLabel('识别测试结果').innerText(); assert.match(zh, /学习日语|學習日語/); results.push({ language: 'zh', text: zh, elapsedMs: Date.now() - started }); check('真实中文音频经过录音、WAV 编码和 Whisper，识别结果回填');
    const ja = await panel.evaluate(async bytes => { const begin = await window.pet.voice({ type: 'capture-begin' }); if (!begin.ok) throw new Error(begin.message); const start = performance.now(); const result = await window.pet.voice({ type: 'transcribe', captureId: begin.captureId, audio: Uint8Array.from(bytes).buffer }); return { ...result, elapsedMs: Math.round(performance.now() - start) }; }, [...japanese]);
    assert.equal(ja.ok, true, ja.message); assert.match(ja.text, /日本語/); results.push({ language: 'ja', text: ja.text, elapsedMs: ja.elapsedMs }); check('自动语言判断能真实转写日语');
    await panel.screenshot({ path: path.join(folder, 'settings.png'), fullPage: true });
    assert.deepEqual(errors, []); await app.close(); app = undefined;
    await wait(async () => { try { await fetch('http://127.0.0.1:18080/health', { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, '退出清理识别进程'); check('退出只清理本次自动启动的识别服务');
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, results, sampleSource: '合成声音；非物理麦克风、非真人口音评估', model: 'Whisper small-q5_1 CPU 8 threads' }, null, 2)); console.log(JSON.stringify(results));
  } catch (error) { const panel = app?.windows().find(p => p.url().includes('page=panel')); if (panel) { console.error(await panel.getByRole('status').allTextContents()); await panel.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }).catch(() => {}); } throw error; }
  finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
