// 隔离用户数据 + 本机模型夹具；不读取用户凭证，也不向真实账号发起请求。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const folder = path.resolve('test-results/diary'); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  // 本脚本专测手动操作；自动时钟另有独立脚本，避免夜间运行时两个流程竞争。
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(userDir, 'diary-schedule.json'), JSON.stringify({ version: 1, startedDate: nextDate, nextDate, retryAt: 0 }));
  const target = path.join(userDir, '日记 存档'), second = path.join(userDir, '另一个目录');
  const checks = [], errors = [], calls = []; let responseMode = 'ok', arrived = false;
  const check = message => { checks.push(message); console.log('PASS', message); };
  const wait = async predicate => { const until = Date.now() + 30000; while (Date.now() < until) { if (await predicate()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error('等待超时'); };
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push(JSON.parse(Buffer.concat(chunks).toString())); arrived = true;
    if (responseMode === 'wait') return;
    if (responseMode === 'fail') { res.writeHead(503).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '今天还没聊过天，我先把这份安静的陪伴记下来。\n\n等你有空，我们再一起分享今天的小事。' } }] }));
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  let app, panel;
  async function launch() {
    app = await electron.launch({ ...(process.env.PET_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')));
    panel = app.windows().find(p => p.url().includes('page=panel'));
    await wait(async () => (await panel.evaluate(() => window.pet.getDebug()))?.groups.length > 0);
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click();
    await panel.getByRole('button', { name: '日记', exact: true }).click();
    await panel.getByLabel('日记保存目录').waitFor();
  }
  const state = () => panel.evaluate(async () => (await window.pet.diary({ type: 'state' })).state);
  try {
    await launch();
    const initial = await state(); assert.equal(initial.defaultDirectory.toLowerCase(), path.resolve('.').toLowerCase());
    check('源码与仓库内发布程序默认识别项目根目录');
    await panel.getByLabel('日记保存目录').fill(target); await panel.getByRole('button', { name: '保存地址', exact: true }).click();
    await wait(async () => (await state()).directory === target && !(await state()).busy);
    await panel.getByRole('button', { name: '写今天的日记', exact: true }).click();
    await wait(async () => (await state()).content.includes('本地纪事'));
    const first = await state(), file = path.join(target, first.files[0].name);
    assert.equal(await fs.readFile(file, 'utf8'), first.content); assert.equal(calls.length, 0);
    check('中文空格路径可保存，普通模式一键生成真实 Markdown 文件且不联网');
    await panel.getByRole('button', { name: '写今天的日记', exact: true }).click();
    await wait(async () => ((await state()).content.match(/^## /gm) || []).length === 2);
    assert.ok((await fs.readFile(file, 'utf8')).startsWith(first.content.trimEnd()));
    check('同一天追加而不覆盖，正文能在窗口中直接查看');
    // 原生选择器与打开文件夹边界用测试进程内的可观测替身，不操作用户的资源管理器。
    await app.evaluate(({ dialog, shell }, directory) => {
      dialog.showOpenDialog = async (...args) => { globalThis.diaryDialog = args[args.length - 1]; return { canceled: false, filePaths: [directory] }; };
      shell.openPath = async value => { globalThis.diaryOpened = value; return ''; };
    }, second);
    await panel.getByRole('button', { name: '选择文件夹', exact: true }).click();
    await wait(async () => (await state()).directory === second);
    assert.ok((await app.evaluate(() => globalThis.diaryDialog)).properties.includes('openDirectory'));
    await panel.getByRole('button', { name: '打开日记文件夹', exact: true }).click();
    await wait(async () => await app.evaluate(() => globalThis.diaryOpened) === second);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await panel.getByRole('button', { name: '选择文件夹', exact: true }).click();
    assert.equal((await state()).directory, second);
    check('选择文件夹、取消选择及打开目录的原生接口正确绑定');
    await panel.getByLabel('日记保存目录').fill(target); await panel.getByRole('button', { name: '保存地址', exact: true }).click();
    await wait(async () => (await state()).directory === target);
    await panel.evaluate(async url => {
      const { state } = await window.pet.companion({ type: 'state' });
      state.data.config.enabled = true; state.data.config.model.baseUrl = url; state.data.config.model.model = 'diary-fixture';
      state.data.config.initiative.enabled = false; state.data.config.speech.enabled = false;
      const saved = await window.pet.companion({ type: 'configure', config: state.data.config }); if (!saved.ok) throw new Error(saved.message);
    }, `http://127.0.0.1:${backend.address().port}/v1`);
    await panel.getByRole('button', { name: '写今天的日记', exact: true }).click();
    await wait(async () => (await state()).content.includes('智能日记'));
    assert.equal(calls.length, 1); assert.equal(calls[0].tools, undefined);
    assert.equal(calls[0].messages.length, 2);
    check('启用模型后一次请求生成第一人称日记，不传入工具或凭证配置');
    await panel.locator('.diary-heading').scrollIntoViewIfNeeded();
    await panel.screenshot({ path: path.join(folder, 'settings.png') });
    await panel.getByRole('article', { name: '日记正文' }).scrollIntoViewIfNeeded();
    await panel.screenshot({ path: path.join(folder, 'reader.png') });
    const stable = await fs.readFile(file, 'utf8'); responseMode = 'fail';
    await panel.getByRole('button', { name: '写今天的日记', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: '503' }).waitFor(); assert.equal(await fs.readFile(file, 'utf8'), stable);
    check('模型失败显示可读错误，旧日记不受影响');
    responseMode = 'wait'; arrived = false;
    await panel.getByRole('button', { name: '写今天的日记', exact: true }).click(); await wait(() => arrived);
    await panel.getByRole('button', { name: '停止写日记', exact: true }).click();
    await wait(async () => !(await state()).busy); assert.equal(await fs.readFile(file, 'utf8'), stable);
    check('可停止正在生成的日记，不保存半篇内容');
    const pet = app.windows().find(p => p.url().includes('page=pet'));
    assert.equal(await pet.evaluate(async () => { try { await window.pet.diary({ type: 'state' }); return false; } catch (e) { return String(e).includes('IPC_FORBIDDEN'); } }), true);
    const invalid = await panel.evaluate(async () => { try { await window.pet.diary({ type: 'read', date: '../package.json' }); return false; } catch { return true; } }); assert.equal(invalid, true);
    check('人物窗口不能访问日记，日期接口拒绝路径穿越');
    await app.close(); app = undefined; await launch();
    assert.equal((await state()).directory, target); await wait(async () => (await state()).content === stable);
    check('真实退出重启后保存位置与日记正文恢复');
    await panel.getByRole('button', { name: '恢复默认位置', exact: true }).click();
    await wait(async () => (await state()).directory === initial.defaultDirectory);
    assert.equal(await fs.readFile(file, 'utf8'), stable);
    check('恢复默认目录不移动或删除旧日记');
    assert.deepEqual(errors, []); check('无渲染异常');
  } finally {
    if (app) await app.close(); backend.closeAllConnections(); await new Promise(r => backend.close(r));
    await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ at: new Date().toISOString(), executable: process.env.PET_TEST_EXECUTABLE || 'source', userDir, checks, errors }, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
