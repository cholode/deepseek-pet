// 隔离用户目录；默认使用延迟音频夹具验证并发，设置 PET_GPT_SOVITS_DIRECTORY 后验证真实模型。
const { _electron: electron } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

(async () => {
  const real = process.env.PET_GPT_SOVITS_DIRECTORY;
  const realVoicevox = process.env.PET_VOICEVOX_DIRECTORY;
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE);
  const workers = Number(process.env.PET_GPT_WORKERS || 2);
  const threads = Number(process.env.PET_GPT_THREADS || 16);
  assert.ok(Number.isInteger(workers) && workers >= 1 && workers <= 4);
  assert.ok(Number.isInteger(threads) && threads >= 1 && threads <= 64);
  const folder = path.resolve(`test-results/gpt-sovits${real ? '-real' : ''}${packaged ? '-packaged' : ''}`);
  await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const checks = [], errors = [], timeline = []; let app, held = [], hold = false, poolHealth;
  const check = text => { checks.push(text); console.log('PASS', text); };
  const wait = async (fn, label, ms = 120000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error(`等待超时：${label}`); };
  const wav = Buffer.alloc(44 + 16000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/health') return res.end(JSON.stringify({ service: 'deepblue-gpt-sovits', protocol: 1, ready: true, voices: [{ id: 'happy', name: '开心' }] }));
    if (url.pathname === '/version') return res.end('"fixture"');
    if (url.pathname === '/speakers') return res.end(JSON.stringify([{ name: '雨晴はう', styles: [{ name: 'ノーマル', id: 10 }] }]));
    if (url.pathname === '/audio_query') return res.end(JSON.stringify({ accent_phrases: [], speedScale: 1 }));
    const lane = url.pathname === '/v1/audio/speech' ? 'zh' : url.pathname === '/synthesis' ? 'ja' : null;
    if (!lane) return res.writeHead(404).end();
    timeline.push({ lane, phase: 'start', at: Date.now() });
    if (hold) { held.push(res); return; }
    // 刻意让中文较慢；若仍全局串行，日文不会在中文完成前进入服务。
    await new Promise(r => setTimeout(r, lane === 'zh' ? 700 : 80));
    timeline.push({ lane, phase: 'end', at: Date.now() });
    res.setHeader('Content-Type', 'audio/wav'); res.end(wav);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await wait(() => app.windows().some(page => page.url().includes('page=panel')), '小屋');
    const panel = app.windows().find(page => page.url().includes('page=panel'));
    await panel.evaluate(() => {
      window.gptPlayback = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { window.gptPlayback.push({ phase: 'start', at: Date.now() }); const ended = this.onended; this.onended = event => { window.gptPlayback.push({ phase: 'end', at: Date.now(), duration: this.duration }); ended?.call(this, event); }; return play.call(this); };
    });
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    await panel.getByLabel('声音分配', { exact: true }).selectOption('language');
    await panel.getByLabel('中文朗读方式', { exact: true }).selectOption('gpt-sovits');
    await panel.getByLabel('参考音色情绪', { exact: true }).selectOption('happy');
    await panel.getByLabel('GPT-SoVITS 地址', { exact: true }).fill(real ? 'http://127.0.0.1:9882' : base);
    await panel.getByLabel('VOICEVOX 地址', { exact: true }).fill(realVoicevox ? 'http://127.0.0.1:50031' : base);
    await panel.getByRole('button', { name: '保存对话设置', exact: true }).click();
    await wait(() => panel.getByRole('button', { name: '试听声音', exact: true }).isEnabled(), '保存');
    if (real) {
      await panel.evaluate(async ({ directory, device, voicevox, workers, threads }) => {
        const { state } = await window.pet.voice({ type: 'state' });
        state.config.tts.gptSovits.directory = directory; state.config.tts.gptSovits.device = device; state.config.tts.gptSovits.autoStart = true; state.config.tts.gptSovits.cpuThreads = threads; state.config.tts.gptSovits.workers = workers; state.config.tts.gptSovits.japanese = !voicevox;
        if (voicevox) { state.config.tts.voicevox.directory = voicevox; state.config.tts.voicevox.autoStart = true; state.config.tts.voicevox.device = 'gpu'; state.config.tts.voicevox.cpuThreads = 8; }
        const result = await window.pet.voice({ type: 'configure', config: state.config, secrets: {} }); if (!result.ok) throw Error(result.message);
      }, { directory: real, device: process.env.PET_GPT_DEVICE || 'auto', voicevox: realVoicevox, workers, threads });
      await panel.getByRole('button', { name: '和她聊天', exact: true }).click();
      await panel.getByRole('button', { name: '对话设置', exact: true }).click();
    }
    await panel.getByRole('button', { name: '检查本地声音', exact: true }).click();
    await panel.getByText('GPT-SoVITS 模型与音色已就绪，可以试听中文或日文', { exact: true }).waitFor({ timeout: real ? 240000 : 120000 });
    check(real ? '真实本地模型按需启动并通过健康检查' : '选择中文引擎与参考情绪，保存并检查服务');
    if (real) {
      poolHealth = await (await fetch('http://127.0.0.1:9882/health')).json();
      assert.equal(poolHealth.workers, workers);
      assert.equal(poolHealth.threadsPerWorker ?? poolHealth.threads, Math.max(1, Math.floor(threads / workers)));
      if (process.env.PET_GPT_DEVICE === 'cuda') assert.equal(poolHealth.device, 'cuda');
    }
    await panel.getByRole('button', { name: '试听声音', exact: true }).click();
    await panel.getByText('试听结束', { exact: true }).waitFor({ timeout: 120000 });
    check(real ? '三月七合成“这是我的声音”，真实 Electron 播放至结束' : '中文接口合成并通过 Electron 音频链路播放');
    timeline.length = 0; await panel.evaluate(() => { window.gptPlayback = []; });
    await panel.getByRole('button', { name: '试听中日切换', exact: true }).click();
    await panel.getByText('试听结束', { exact: true }).waitFor({ timeout: 120000 });
    const playback = await panel.evaluate(() => window.gptPlayback);
    assert.deepEqual(playback.map(event => event.phase), ['start', 'end', 'start', 'end', 'start', 'end', 'start', 'end']);
    if (!real) {
      assert.ok(timeline.find(event => event.lane === 'ja' && event.phase === 'start').at < timeline.find(event => event.lane === 'zh' && event.phase === 'end').at);
      check('中文与日文同时合成，四段音频严格依次播放且不重叠');
      hold = true; held = []; await panel.getByRole('button', { name: '试听中日切换', exact: true }).click();
      await wait(() => held.length === 2, '双路在途');
      await panel.getByRole('button', { name: '停止试听', exact: true }).click();
      await wait(() => held.every(response => response.destroyed), '两路取消');
      check('一次停止取消两路在途计算请求，后续句子不再播放');
    } else check(realVoicevox ? '真实三月七中文与雨晴はう核显合成，四段音频按序播放完成' : '真实三月七中文与日文使用同一模型，四段音频播放完成');
    await panel.screenshot({ path: path.join(folder, 'settings.png'), fullPage: true });
    const stored = JSON.parse(await fs.readFile(path.join(userDir, 'conversation-settings.json'), 'utf8'));
    assert.equal(stored.config.tts.languageChinese, 'configured'); assert.equal(stored.config.tts.gptSovits.voice, 'happy');
    if (real && process.env.PET_GPT_BENCHMARK) {
      const result = await promisify(execFile)(path.join(real, '.venv/Scripts/python.exe'), ['-I', '-X', 'utf8', '-u', path.resolve('integrations/gpt-sovits/benchmark_service.py'), '--url', 'http://127.0.0.1:9882', '--concurrency', String(Math.min(workers, 2)), '--output', path.resolve('test-results/rocm-gui-pool')], { windowsHide: true, timeout: 300000 });
      console.log(result.stdout);
    }
    if (real) { poolHealth = await (await fetch('http://127.0.0.1:9882/health')).json(); if (workers > 1) assert.equal(poolHealth.peakActive, Math.min(workers, 2)); }
    assert.deepEqual(errors, []); await app.close(); app = undefined;
    if (real) { await wait(async () => { try { await fetch('http://127.0.0.1:9882/health', { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, '清理自己的 Python'); check('退出后桥接及实际 Python 推理进程停止'); }
    if (realVoicevox) { await wait(async () => { try { await fetch('http://127.0.0.1:50031/version', { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, '清理自己的 VOICEVOX'); check('退出关闭自己的 VOICEVOX，未干扰其他端口的服务'); }
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, playback, timeline, poolHealth, realModel: Boolean(real), realVoicevox: Boolean(realVoicevox) }, null, 2));
  } catch (error) {
    const panel = app?.windows().find(page => page.url().includes('page=panel'));
    if (panel) { console.error('UI status:', await panel.getByRole('status').allTextContents()); await panel.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); }
    throw error;
  } finally { await app?.close().catch(() => {}); held.forEach(response => response.destroy()); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
