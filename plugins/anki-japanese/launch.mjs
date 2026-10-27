import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const exists = async file => { try { return await fs.stat(file); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } };
const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

// 只从宿主绑定目录定位 Anki，不接受模型传入命令、路径或启动参数。
export async function launchTarget(directory) {
  if (!directory || !path.isAbsolute(directory) || /^(\\\\|\/\/)/.test(directory)) throw new Error('请先在小屋绑定本机 Anki 所在目录');
  const root = await fs.realpath(directory);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Anki 位置必须是目录');
  const candidates = [];
  for (const relative of ['Anki.exe', path.join('app', 'Anki.exe')]) {
    const file = path.join(root, relative), stat = await exists(file);
    if (!stat) continue;
    const actual = await fs.realpath(file);
    if (!stat.isFile() || !within(root, actual) || path.basename(actual).toLowerCase() !== 'anki.exe') throw new Error('Anki 程序路径无效或指向绑定目录之外，请重新选择目录');
    candidates.push(actual);
  }
  if (!candidates.length) throw new Error('绑定目录中未找到 Anki.exe 或 app/Anki.exe，请在小屋重新定位 Anki 目录');
  if (candidates.length !== 1) throw new Error('绑定目录中存在多个 Anki 程序，请选择仅包含目标 Anki.exe 的目录');
  let dataDirectory;
  const data = path.join(root, 'data'), dataStat = await exists(data);
  if (dataStat) {
    dataDirectory = await fs.realpath(data);
    if (!dataStat.isDirectory() || !within(root, dataDirectory) || !(await exists(path.join(dataDirectory, 'prefs21.db')))?.isFile()) throw new Error('绑定目录的 data 不是有效的现有 Anki 数据目录，请检查位置；未启动 Anki');
  } else if (path.basename(root).toLowerCase() === 'app' && await exists(path.join(root, '..', 'data', 'prefs21.db'))) {
    throw new Error('检测到上一级的 Anki 学习数据，请将软件目录选为同时包含 app 和 data 的文件夹，避免打开错误集合');
  }
  return { executable: candidates[0], dataDirectory };
}

export class AnkiLauncher {
  constructor(directory, { spawnProcess = spawn, platform = process.platform, timeoutMs = 18000, pollMs = 500 } = {}) {
    this.directory = directory; this.spawnProcess = spawnProcess; this.platform = platform; this.timeoutMs = timeoutMs; this.pollMs = pollMs;
    this.lastStarted = 0; this.pending = undefined;
  }
  async open(probe, profile, signal) {
    signal?.throwIfAborted();
    if (this.pending) return this.pending;
    this.pending = this.run(probe, profile, signal);
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  async run(probe, profile, signal) {
    const check = async () => {
      signal?.throwIfAborted();
      try { return await probe(AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1500)])); }
      catch { signal?.throwIfAborted(); return undefined; }
    };
    const ready = (value, started) => ({ started, connected: true, activeProfile: value.activeProfile,
      profileMatches: !profile || value.activeProfile === profile,
      summary: `${started ? 'Anki 已启动，接口已就绪' : 'Anki 已在运行，接口已就绪'}。当前用户：${value.activeProfile}。${profile && value.activeProfile !== profile ? '当前用户与学习计划不一致，请在 Anki 切换用户后再学习。' : '可继续检查学习计划。'}` });
    const existing = await check();
    if (existing) return ready(existing, false);
    if (this.platform !== 'win32') throw new Error('当前启动工具仅支持 Windows，请手动打开 Anki');
    if (Date.now() - this.lastStarted < 30000) return { started: false, connected: false, summary: '刚刚已发起 Anki 启动，接口仍未就绪；请检查 Anki 窗口或稍后调用 anki_status。未重复启动。' };
    const target = await launchTarget(this.directory);
    signal?.throwIfAborted();
    const args = [...(target.dataDirectory ? ['-b', target.dataDirectory] : []), ...(profile ? ['-p', profile] : [])];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    let child, failure;
    try {
      // Anki 是用户可见的应用；独立于插件存活，不经 shell，也不在取消聊天时强杀。
      child = this.spawnProcess(target.executable, args, { cwd: path.dirname(target.executable), env, shell: false, detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', e => { failure = e; });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      this.lastStarted = Date.now(); child.unref();
    } catch (e) { throw new Error(`Anki 启动失败：${e.code || e.message}`); }
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const value = await check(); if (value) return ready(value, true);
      if (failure || (child.exitCode !== null && child.exitCode !== 0) || child.signalCode) throw new Error(`Anki 启动进程异常退出：${failure?.code || child.signalCode || child.exitCode}；请检查 Anki 窗口`);
      await sleep(Math.min(this.pollMs, Math.max(1, deadline - Date.now())), undefined, { signal });
    }
    return { started: true, connected: false, summary: '已发起 Anki 启动，但 AnkiConnect 尚未就绪。请检查 Anki 是否停在用户选择或错误窗口，并确认 AnkiConnect 已安装启用；稍后调用 anki_status。不能声称已经连接或已记录学习。' };
  }
}
