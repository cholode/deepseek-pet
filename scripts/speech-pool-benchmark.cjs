// 相同四句比较旧单进程与新双进程；两边分别首次合成，记录缓存命中，避免把缓存当加速。
const fs = require('node:fs/promises');
const originalSentences = ['今天我们一起练习新的日语句子。', '先听一遍，然后试着用自己的话回答。', '答错也没有关系，我们可以慢慢练习。', '最后再回忆一下刚才学过的内容。'];
const startNumber = Math.floor(Date.now() / 1000) % 100;
const sentences = originalSentences.map((text, index) => `第${startNumber + index}题。${text}`);
(async () => {
  const results = [];
  for (const [label, url, concurrent] of [['single', 'http://127.0.0.1:9881', false], ['pool', 'http://127.0.0.1:9884', true]]) {
    const began = performance.now(), samples = [];
    const synth = async input => {
      const started = performance.now(); const response = await fetch(url + '/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, voice: 'happy', language: 'zh' }), signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error(`${label} HTTP ${response.status}`); const bytes = await response.arrayBuffer();
      samples.push({ input, startMs: started - began, endMs: performance.now() - began, ms: performance.now() - started, worker: response.headers.get('x-worker'), cache: response.headers.get('x-audio-cache'), bytes: bytes.byteLength });
    };
    if (concurrent) await Promise.all(sentences.map(synth)); else for (const text of sentences) await synth(text);
    const result = { label, elapsedMs: performance.now() - began, samples, health: await fetch(url + '/health').then(r => r.json()) }; results.push(result); console.log(JSON.stringify(result));
  }
  await fs.writeFile('test-results/speech-pool-benchmark.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
