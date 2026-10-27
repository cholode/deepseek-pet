import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
// @ts-expect-error standalone JavaScript plugin
import { AnkiLauncher, launchTarget } from '../plugins/anki-japanese/launch.mjs';
// @ts-expect-error standalone JavaScript plugin
import { AnkiPlugin } from '../plugins/anki-japanese/core.mjs';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function folder() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anki-launch-')); roots.push(root); return root; }
async function installation(portable = false) {
  const root = await folder(), executable = path.join(root, ...(portable ? ['app'] : []), 'Anki.exe');
  await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, 'not executable: test fixture');
  if (portable) { await fs.mkdir(path.join(root, 'data')); await fs.writeFile(path.join(root, 'data', 'prefs21.db'), 'fixture'); }
  return { root, executable };
}
function processFixture(error?: string) {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, unref: vi.fn(), kill: vi.fn() });
  const spawnProcess = vi.fn(() => { queueMicrotask(() => child.emit(error ? 'error' : 'spawn', error ? Object.assign(new Error(error), { code: error }) : undefined)); return child; });
  return { child, spawnProcess };
}
const offline = async () => { throw new Error('offline'); };
const online = async () => ({ activeProfile: '账户 1' });

describe('Anki 启动工具', () => {
  it('已就绪时只读检查，不启动进程；错误用户明确报告且不切换集合', async () => {
    const f = processFixture(), launcher = new AnkiLauncher(undefined, f);
    expect(await launcher.open(online, '')).toMatchObject({ connected: true, started: false, profileMatches: true });
    expect(await launcher.open(online, '其他用户')).toMatchObject({ connected: true, started: false, profileMatches: false, summary: expect.stringContaining('不一致') });
    expect(f.spawnProcess).not.toHaveBeenCalled();
  });
  it('定位标准安装及 app/data 布局，保留已有数据，参数无 shell 插值', async () => {
    const installed = await installation(true), f = processFixture(); let probes = 0;
    const launcher = new AnkiLauncher(installed.root, { ...f, platform: 'win32', pollMs: 1 });
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    const result = await launcher.open(async () => { if (!probes++) throw new Error('offline'); return online(); }, '账户 & 1');
    expect(result).toMatchObject({ started: true, connected: true });
    const [exe, args, options] = f.spawnProcess.mock.calls[0] as unknown as [string, string[], { shell: boolean; env: Record<string, string>; windowsHide: boolean }];
    expect(exe).toBe(installed.executable); expect(args).toEqual(['-b', path.join(installed.root, 'data'), '-p', '账户 & 1']);
    expect(options.shell).toBe(false); expect(options.windowsHide).toBe(false); expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(f.child.unref).toHaveBeenCalledOnce();
    const standard = await installation(); expect(await launchTarget(standard.root)).toEqual({ executable: standard.executable, dataDirectory: undefined });
  });
  it('路径缺失、含多个程序及错误数据布局拒绝启动，不悄悄换成默认集合', async () => {
    const root = await folder(); await expect(launchTarget(root)).rejects.toThrow('未找到');
    await expect(launchTarget('relative')).rejects.toThrow('本机');
    const installed = await installation(true);
    await expect(launchTarget(path.join(installed.root, 'app'))).rejects.toThrow('同时包含 app 和 data');
    await fs.writeFile(path.join(installed.root, 'Anki.exe'), 'fixture'); await expect(launchTarget(installed.root)).rejects.toThrow('多个');
    const badData = await installation(); await fs.mkdir(path.join(badData.root, 'data')); await expect(launchTarget(badData.root)).rejects.toThrow('现有 Anki 数据');
  });
  it('拒绝越界的数据目录联接', async () => {
    const installed = await installation(), outside = await folder(); await fs.writeFile(path.join(outside, 'prefs21.db'), 'fixture');
    await fs.symlink(outside, path.join(installed.root, 'data'), 'junction');
    await expect(launchTarget(installed.root)).rejects.toThrow('现有 Anki 数据');
  });
  it('进程启动失败、异常退出都不误报已连接', async () => {
    const installed = await installation();
    await expect(new AnkiLauncher(installed.root, { ...processFixture('EACCES'), platform: 'win32' }).open(offline, '')).rejects.toThrow('EACCES');
    const f = processFixture(); f.child.exitCode = 3;
    await expect(new AnkiLauncher(installed.root, { ...f, platform: 'win32' }).open(offline, '')).rejects.toThrow('异常退出：3');
  });
  it('缺少接口时如实返回未就绪，并发和短时间重复调用只启动一次', async () => {
    const installed = await installation(), f = processFixture(), launcher = new AnkiLauncher(installed.root, { ...f, platform: 'win32', timeoutMs: 15, pollMs: 1 });
    const [one, two] = await Promise.all([launcher.open(offline, ''), launcher.open(offline, '')]);
    expect(one).toMatchObject({ started: true, connected: false }); expect(two).toEqual(one);
    expect(await launcher.open(offline, '')).toMatchObject({ started: false, connected: false, summary: expect.stringContaining('未重复启动') });
    expect(f.spawnProcess).toHaveBeenCalledOnce();
  });
  it('取消前不启动，取消等待时不杀 Anki，随后仍不重复启动', async () => {
    const installed = await installation(), f = processFixture(), launcher = new AnkiLauncher(installed.root, { ...f, platform: 'win32', timeoutMs: 1000, pollMs: 1 });
    const before = new AbortController(); before.abort();
    await expect(launcher.open(offline, '', before.signal)).rejects.toThrow(); expect(f.spawnProcess).not.toHaveBeenCalled();
    const during = new AbortController(); let probes = 0;
    await expect(launcher.open(async () => { if (++probes === 2) during.abort(); throw new Error('offline'); }, '', during.signal)).rejects.toThrow();
    expect(f.spawnProcess).toHaveBeenCalledOnce(); expect(f.child.kill).not.toHaveBeenCalled();
    expect(await launcher.open(offline, '')).toMatchObject({ connected: false, started: false });
  });
  it('启动不依赖学习计划，拒绝模型传入命令或路径；状态和提醒不会启动', async () => {
    const launcher = { open: vi.fn(async () => ({ started: true, connected: false })) };
    const plugin = new AnkiPlugin(await folder(), { launcher, request: offline }); await plugin.load();
    await plugin.call('anki_status', {}); await plugin.call('anki_reminder', {}); expect(launcher.open).not.toHaveBeenCalled();
    await expect(plugin.call('anki_launch', { executable: 'cmd.exe' })).rejects.toThrow('未知字段');
    expect(await plugin.call('anki_launch', {})).toEqual({ started: true, connected: false }); expect(launcher.open).toHaveBeenCalledOnce();
  });
});
