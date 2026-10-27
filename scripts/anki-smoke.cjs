// 真实 Anki 只读连通验证；不会创建笔记、切换用户或提交评分。
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const { AnkiPlugin } = await import('../plugins/anki-japanese/core.mjs');
  const folder = path.resolve('test-results/anki'); await fs.mkdir(folder, { recursive: true });
  const plugin = new AnkiPlugin(await fs.mkdtemp(path.join(folder, 'readonly-'))); await plugin.load();
  const result = await plugin.call('anki_status', {}, new AbortController().signal);
  if (!result.connected) throw new Error(result.summary);
  const report = { checkedAt: new Date().toISOString(), realAnki: true, readOnly: true, connected: true, deckCount: result.decks.length, writesPerformed: 0 };
  await fs.writeFile(path.join(folder, 'real-anki-readonly.json'), JSON.stringify(report, null, 2)); console.log(report);
})().catch(e => { console.error(e); process.exitCode = 1; });
