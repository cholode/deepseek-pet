import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VoiceConfig } from '../../shared/voice';
import { voiceEndpoint } from './audio';

type Config = VoiceConfig['tts']['gptSovits'];
export function gptSovitsEndpoint(raw: string) {
  const url = voiceEndpoint(raw, 'local');
  if (url.protocol !== 'http:' || url.pathname !== '/') throw new Error('GPT-SoVITS 请填写本机 HTTP 服务根地址，例如 http://127.0.0.1:9881');
  return url;
}
export async function findGptSovits(directory: string, device: Config['device'] = 'auto') {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('请选择本机 GPT-SoVITS 语音服务目录');
  const root = await fs.realpath(directory);
  const files: string[] = [];
  for (const relative of ['.venv/Scripts/python.exe', 'bridge.py', 'runtime.json', 'worker_pool.py']) {
    try {
      const resolved = await fs.realpath(path.join(root, relative)); const inside = path.relative(root, resolved);
      if (inside.startsWith('..') || path.isAbsolute(inside) || !(await fs.stat(resolved)).isFile()) throw new Error('invalid');
      files.push(resolved);
    } catch { throw new Error('目录缺少 GPT-SoVITS 的 Python 环境、runtime.json 或桥接代码；请同时更新 bridge.py 和 worker_pool.py'); }
  }
  let executable = files[0];
  if (device !== 'cpu') {
    // GPU 环境先独立安装、实测，再写入就绪标记；下载到一半不能抢走可用的 CPU 环境。
    const installed = await fs.readFile(path.join(root, 'gpu-runtime.json'), 'utf8').then(raw => {
      return z.object({ schemaVersion: z.literal(1), backend: z.literal('rocm'), validated: z.literal(true), autoDevice: z.enum(['cpu', 'cuda']).optional() }).parse(JSON.parse(raw));
    }).catch(() => undefined);
    // “可运行”不等于“更快”。安装后的真实基准可推荐 CPU，手动 GPU 仍可覆盖。
    if (installed && (device === 'cuda' || installed.autoDevice !== 'cpu')) {
      const gpu = await fs.realpath(path.join(root, '.venv-rocm/Scripts/python.exe')).catch(() => undefined);
      if (gpu) {
        const inside = path.relative(root, gpu);
        if (inside.startsWith('..') || path.isAbsolute(inside) || !(await fs.stat(gpu)).isFile()) throw new Error('GPU Python 环境必须位于绑定的语音服务目录内');
        executable = gpu;
      } else if (device === 'cuda') throw new Error('已验证的 GPU 环境缺失，请修复 .venv-rocm 或切回 CPU');
    }
  }
  return { root, executable, bridge: files[1], gpuRuntime: executable !== files[0] };
}
export function gptSovitsStartArgs(config: Config, bridge: string) {
  const url = gptSovitsEndpoint(config.url);
  return ['-I', '-X', 'utf8', '-u', bridge, '--host', url.hostname.replace(/^\[|\]$/g, ''), '--port', url.port || '80', '--threads', String(config.cpuThreads), '--workers', String(config.workers), '--device', config.device, '--parent-stdin'];
}
const healthSchema = z.object({ service: z.literal('deepblue-gpt-sovits'), protocol: z.literal(1), ready: z.literal(true), device: z.string().optional(), voices: z.array(z.object({ id: z.string(), name: z.string() })).max(100) });

// 固定入口启动用户已绑定的服务。退出/换配置时只关闭自己的 stdin 管道与子进程，不调用全局进程清理。
export class GptSovitsProcess {
  private child?: ChildProcess; private starting?: Promise<void>; private lifetime = new AbortController();
  async ensure(config: Config, signal: AbortSignal) {
    const root = gptSovitsEndpoint(config.url), lifetime = this.lifetime.signal;
    const combined = AbortSignal.any([signal, lifetime]); combined.throwIfAborted();
    const probe = async () => {
      try {
        const response = await fetch(new URL('health', root), { redirect: 'error', signal: AbortSignal.any([combined, AbortSignal.timeout(1500)]) });
        if (!response.ok || Number(response.headers.get('content-length')) > 16384) { await response.body?.cancel(); return false; }
        const health = healthSchema.parse(await response.json());
        if (!health.voices.some(v => v.id === config.voice)) throw new Error('所选 GPT-SoVITS 音色不存在，请检查语音服务配置');
        if (config.device === 'cuda' && health.device !== 'cuda') throw new Error('当前端口没有使用 GPU，请重新启动语音服务后再检查');
        return true;
      } catch (error) { combined.throwIfAborted(); if (error instanceof Error && /音色不存在|没有使用 GPU/.test(error.message)) throw error; return false; }
    };
    if (await probe()) return;
    if (!config.autoStart || !config.directory) throw new Error('GPT-SoVITS 尚未运行，请选择语音服务目录并开启按需启动');
    if (process.platform !== 'win32') throw new Error('GPT-SoVITS 按需启动当前支持 Windows');
    if (!this.starting) this.starting = (async () => {
      if (this.child) throw new Error('GPT-SoVITS 服务未响应，请重新保存设置后再试');
      const engine = await findGptSovits(config.directory, config.device); combined.throwIfAborted();
      const child = spawn(engine.executable, gptSovitsStartArgs(config, engine.bridge), { cwd: engine.root, windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' } });
      this.child = child; let failed = false;
      // 排空 stderr，避免 Python 日志塞满管道；不把聊天文本或本地路径推送到界面日志。
      child.stderr?.on('data', () => {}); child.stdin?.on('error', () => {});
      child.on('error', () => { failed = true; if (this.child === child) this.child = undefined; });
      child.on('exit', () => { failed = true; if (this.child === child) this.child = undefined; });
      try {
        // ROCm 为降低共享内存峰值依次加载，每一路都需要完整启动预算；CPU 仍并行加载。
        const deadline = Date.now() + 110000 * (engine.gpuRuntime ? config.workers : 1);
        while (Date.now() < deadline) {
          if (failed) throw new Error('GPT-SoVITS 启动失败，请检查服务目录、模型和运行依赖');
          if (await probe()) return;
          await delay(300, undefined, { signal: combined });
        }
        throw new Error('GPT-SoVITS 加载模型超时，请检查本地服务');
      } catch (error) { if (this.child === child) { child.stdin?.end(); child.kill(); this.child = undefined; } throw error; }
    })().finally(() => { this.starting = undefined; });
    await this.starting; combined.throwIfAborted();
  }
  async close() {
    this.lifetime.abort(); this.child?.stdin?.end(); this.child?.kill(); this.child = undefined;
    await this.starting?.catch(() => {}); this.lifetime = new AbortController();
  }
}
