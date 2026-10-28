import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { availableParallelism } from 'node:os';
import type { VoiceConfig } from '../../shared/voice';
import { voiceEndpoint } from './audio';

type Config = VoiceConfig['tts']['voicevox'];
export function voicevoxStartArgs(config: Config, logicalCpus = availableParallelism()): string[] {
  const url = voicevoxEndpoint(config.url);
  const threads = config.cpuThreads || Math.max(1, Math.min(16, Math.floor(logicalCpus / 2)));
  return ['--host', url.hostname.replace(/^\[|\]$/g, ''), '--port', url.port || (url.protocol === 'https:' ? '443' : '80'), config.device === 'gpu' ? '--use_gpu' : '--no-use_gpu', '--cpu_num_threads', String(threads), '--disable_mutable_api', '--output_log_utf8'];
}
export function voicevoxEndpoint(raw: string) {
  const url = voiceEndpoint(raw, 'local');
  if (url.pathname !== '/') throw new Error('VOICEVOX 地址只填写本机地址和端口，例如 http://127.0.0.1:50021');
  return url;
}
export async function findVoicevoxEngine(directory: string): Promise<string> {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('请选择本机已安装的 VOICEVOX 目录');
  const root = await fs.realpath(directory);
  for (const relative of ['run.exe', 'vv-engine/run.exe', 'VOICEVOX/vv-engine/run.exe']) {
    const candidate = path.join(root, relative);
    try {
      const resolved = await fs.realpath(candidate); const inside = path.relative(root, resolved);
      if (inside.startsWith('..') || path.isAbsolute(inside)) continue;
      if ((await fs.stat(resolved)).isFile() && (await fs.stat(path.join(path.dirname(resolved), 'voicevox_core.dll'))).isFile()) return resolved;
    } catch { /* 兼容软件目录、解压目录和引擎目录。 */ }
  }
  throw new Error('目录中没有找到 VOICEVOX 的 vv-engine/run.exe 和 voicevox_core.dll');
}

// 仅启动用户在小屋绑定的本机引擎，参数固定；模型不能指定路径、命令或启动任意软件。
export class VoicevoxProcess {
  private child?: ChildProcess; private starting?: Promise<void>; private lifetime = new AbortController();
  async ensure(config: Config, signal: AbortSignal) {
    const url = voicevoxEndpoint(config.url); const lifetime = this.lifetime.signal; signal.throwIfAborted();
    const probe = async () => {
      try {
        const response = await fetch(new URL('version', url), { redirect: 'error', signal: AbortSignal.any([signal, lifetime, AbortSignal.timeout(1500)]) });
        await response.body?.cancel(); return response.ok;
      } catch { signal.throwIfAborted(); lifetime.throwIfAborted(); return false; }
    };
    if (await probe()) return;
    if (!config.autoStart || !config.directory) throw new Error('VOICEVOX 未运行，请打开 VOICEVOX，或在对话设置选择目录并开启按需启动');
    if (process.platform !== 'win32') throw new Error('按需启动当前支持 Windows；其他平台请手动启动 VOICEVOX');
    if (!this.starting) {
      this.starting = (async () => {
        if (this.child) throw new Error('已启动的 VOICEVOX 未响应，请检查服务或重新保存设置');
        const executable = await findVoicevoxEngine(config.directory);
        lifetime.throwIfAborted(); signal.throwIfAborted();
        const child = spawn(executable, voicevoxStartArgs(config), { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore', shell: false });
        this.child = child; let failed = false;
        child.on('error', () => { failed = true; if (this.child === child) this.child = undefined; });
        child.on('exit', () => { failed = true; if (this.child === child) this.child = undefined; });
        try {
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            if (failed) throw new Error(config.device === 'gpu' ? 'VOICEVOX GPU 模式启动失败，请检查显卡驱动和引擎版本，或切换 CPU 模式' : 'VOICEVOX 启动失败，请检查安装目录和端口是否被占用');
            if (await probe()) return;
            await delay(250, undefined, { signal: AbortSignal.any([signal, lifetime]) });
          }
          throw new Error('VOICEVOX 启动超时，请尝试手动打开软件');
        } catch (error) { if (this.child === child) { child.kill(); this.child = undefined; } throw error; }
      })().finally(() => { this.starting = undefined; });
    }
    await this.starting; signal.throwIfAborted();
  }
  stop() { this.lifetime.abort(); this.child?.kill(); this.child = undefined; this.lifetime = new AbortController(); }
  async close() { this.stop(); await this.starting?.catch(() => {}); }
}
