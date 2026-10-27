// 用已安装的 Windows Anki 程序和既有测试集合的副本验证冷启动；不操作用户集合。
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

(async () => {
  const appDirectory = process.env.ANKI_LAUNCH_TEST_APP;
  const fixture = process.env.ANKI_LAUNCH_TEST_DATA;
  if (!appDirectory || !fixture) throw new Error('需要 ANKI_LAUNCH_TEST_APP 和 ANKI_LAUNCH_TEST_DATA（位于 test-results 的隔离集合）');
  const testsRoot = await fs.realpath(path.resolve('test-results')), source = await fs.realpath(fixture);
  if (!source.startsWith(testsRoot + path.sep)) throw new Error('只允许复制 test-results 中的测试集合');
  const root = await fs.mkdtemp(path.join(testsRoot, 'anki-launch-')), target = path.join(root, 'target'), data = path.join(target, 'data'), store = path.join(root, 'plugin-data');
  await fs.mkdir(target); await fs.mkdir(store); await fs.cp(source, data, { recursive: true });
  // 复用本机程序，只在新测试目录创建硬链接/目录联接，不修改原安装。
  for (const item of await fs.readdir(appDirectory, { withFileTypes: true })) {
    const from = path.join(appDirectory, item.name), to = path.join(target, item.name);
    if (item.isDirectory()) await fs.symlink(from, to, 'junction'); else if (item.isFile()) await fs.link(from, to);
  }
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const metaFile = path.join(data, 'addons21', '2055492159', 'meta.json'), meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
  meta.config.webBindPort = port; await fs.writeFile(metaFile, JSON.stringify(meta));
  const profiles = (await fs.readdir(data, { withFileTypes: true })).filter(d => d.isDirectory() && !['addons21', 'logs'].includes(d.name));
  assert.equal(profiles.length, 1); const profile = profiles[0].name;
  const { AnkiPlugin } = await import('../plugins/anki-japanese/core.mjs');
  const seed = new AnkiPlugin(store); seed.state.settings.profile = profile; seed.state.settings.port = port; await seed.save();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'anki-launch-readonly-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/anki-japanese/server.mjs')], stderr: 'pipe', env: { DAFEIYU_PLUGIN_DATA_DIRECTORY: store, DAFEIYU_SOFTWARE_DIRECTORY: target, ANKI_SINGLE_INSTANCE_KEY: `dafeiyu-launch-${port}` } });
  transport.stderr?.on('data', () => {});
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 9);
    const invoke = async () => { const response = await client.callTool({ name: 'anki_launch', arguments: {} }, undefined, { timeout: 30000 }); assert.ok(!response.isError, JSON.stringify(response)); return JSON.parse(response.content[0].text); };
    const launched = await invoke();
    assert.equal(launched.started, true); assert.equal(launched.connected, true, launched.summary); assert.equal(launched.activeProfile, profile);
    const repeated = await invoke(); assert.equal(repeated.started, false); assert.equal(repeated.connected, true);
    const report = { checkedAt: new Date().toISOString(), realAnki: true, coldStart: true, realMcpProcess: true, isolatedCollectionCopy: true, writesPerformed: 0, port, launched, repeated };
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, reportFile: path.join(root, 'report.json') }, null, 2));
  } finally {
    await client.close();
    // 此集合是可丢弃的测试副本。当前 AnkiConnect 的 guiExitAnki 可能报错，
    // 按本轮新建目录中的精确 EXE 路径清理测试进程，绝不按 Anki 名称批量退出。
    const executable = path.join(target, 'Anki.exe');
    assert.ok(executable.startsWith(testsRoot + path.sep));
    const quoted = "'" + executable.replaceAll("'", "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${quoted} } | ForEach-Object { Stop-Process -Id $_.ProcessId }`], { windowsHide: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
