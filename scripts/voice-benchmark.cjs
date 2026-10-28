// 真实本机引擎基准；只启动、清理本脚本拥有的子进程，不修改用户设置。
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const executable = process.env.PET_VOICEVOX_EXECUTABLE;
  if (!executable || !path.isAbsolute(executable)) throw new Error('请设置 PET_VOICEVOX_EXECUTABLE 为本机 run.exe 的绝对路径');
  const base = 'http://127.0.0.1:50041';
  try { await fetch(`${base}/version`, { signal: AbortSignal.timeout(1000) }); throw new Error('基准端口 50041 已被占用'); } catch (error) { if (!String(error).includes('fetch failed') && error.name !== 'TimeoutError') throw error; }
  const results = []; const text = 'こんにちは。今日は一緒に日本語を勉強しましょう。';
  for (const [device, threads] of [['cpu', 4], ['cpu', 8], ['cpu', 16], ['gpu', 8]]) {
    const row = { device, threads }; let log = '';
    const child = spawn(executable, ['--host', '127.0.0.1', '--port', '50041', device === 'gpu' ? '--use_gpu' : '--no-use_gpu', '--cpu_num_threads', String(threads), '--disable_mutable_api', '--output_log_utf8'], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit'); child.stdout.on('data', data => { log = (log + data).slice(-12000); }); child.stderr.on('data', data => { log = (log + data).slice(-12000); });
    try {
      const start = performance.now(); let ready = false;
      while (performance.now() - start < 60000) {
        if (child.exitCode !== null) throw new Error('引擎提前退出');
        try { const response = await fetch(`${base}/version`, { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); if (response.ok) { ready = true; break; } } catch { /* 等待启动 */ }
        await wait(250);
      }
      if (!ready) throw new Error('启动超时'); row.startupMs = Math.round(performance.now() - start);
      row.devices = await (await fetch(`${base}/supported_devices`)).json();
      const speakers = await (await fetch(`${base}/speakers`)).json();
      const speaker = speakers.find(s => s.name === '雨晴はう')?.styles.find(s => s.name === 'ノーマル' && ['talk', 'streaming_talk'].includes(s.type))?.id;
      if (speaker === undefined) throw new Error('缺少雨晴はう');
      const synthesize = async () => {
        const began = performance.now();
        const query = await fetch(`${base}/audio_query?${new URLSearchParams({ text, speaker })}`, { method: 'POST', signal: AbortSignal.timeout(120000) });
        if (!query.ok) throw new Error(`query HTTP ${query.status}`);
        const response = await fetch(`${base}/synthesis?speaker=${speaker}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await query.text(), signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`synthesis HTTP ${response.status}`);
        const bytes = await response.arrayBuffer(); if (Buffer.from(bytes).toString('ascii', 0, 4) !== 'RIFF') throw new Error('无效 WAV');
        return Math.round(performance.now() - began);
      };
      row.coldMs = await synthesize(); row.serialMs = [];
      for (let i = 0; i < 3; i++) row.serialMs.push(await synthesize());
      const startParallel = performance.now(); row.parallelMs = await Promise.all([synthesize(), synthesize()]); row.parallelTotalMs = Math.round(performance.now() - startParallel);
    } catch (error) { row.error = error.message; }
    finally { if (child.exitCode === null) child.kill(); await exited; }
    row.gpuEvidence = log.split('\n').filter(line => /DirectML|DmlExecutionProvider|GPU|device.*name|Radeon/i.test(line)).slice(-12);
    results.push(row); console.log(JSON.stringify(row));
  }
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/voice-benchmark.json', JSON.stringify({ text, date: new Date().toISOString(), results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
