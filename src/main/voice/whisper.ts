import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { VoiceConfig } from '../../shared/voice';
import { voiceEndpoint } from './audio';

type Config = VoiceConfig['asr'];
export async function findWhisperEngine(directory: string) {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('请选择本机 whisper.cpp 引擎目录');
  const root = await fs.realpath(directory);
  for (const relative of ['whisper-server.exe', 'Release/whisper-server.exe', 'bin/whisper-server.exe']) {
    try {
      const file = await fs.realpath(path.join(root, relative)); const inside = path.relative(root, file);
      if (!inside.startsWith('..') && !path.isAbsolute(inside) && (await fs.stat(file)).isFile()) return file;
    } catch { /* 兼容 Windows 发布包解压目录。 */ }
  }
  throw new Error('目录中没有找到 whisper-server.exe，请选择 whisper.cpp 引擎目录');
}
export async function validateWhisperModel(file: string) {
  if (!path.isAbsolute(file) || file.startsWith('\\\\') || path.extname(file).toLowerCase() !== '.bin') throw new Error('请选择本机 Whisper GGML .bin 模型文件');
  const resolved = await fs.realpath(file); const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error('Whisper 模型文件无效或尚未下载完成');
  const handle = await fs.open(resolved, 'r');
  try { const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0); if (header.readUInt32LE() !== 0x67676d6c) throw new Error('不是有效的 Whisper GGML 模型'); }
  finally { await handle.close(); }
  return resolved;
}
export function whisperStartArgs(config: Config, model: string) {
  const url = voiceEndpoint(config.local.url, 'local');
  if (url.protocol !== 'http:' || url.pathname !== '/inference') throw new Error('按需启动 whisper.cpp 请使用本机 HTTP 地址，路径为 /inference');
  return ['--host', url.hostname.replace(/^\[|\]$/g, ''), '--port', url.port || '80', '--model', model, '--threads', String(config.whisper.cpuThreads), '--language', 'auto', '--no-gpu', '--max-context', '0'];
}

// 仅运行用户选择目录中的固定服务程序与模型；只关闭自己启动的进程，不创建系统启动项。
export class WhisperProcess {
  private child?: ChildProcess; private starting?: Promise<void>; private lifetime = new AbortController();
  async ensure(config: Config, signal: AbortSignal) {
    const lifetime = this.lifetime.signal; const url = new URL('/health', voiceEndpoint(config.local.url, 'local'));
    const probe = async () => {
      try { const r = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, lifetime, AbortSignal.timeout(1500)]) }); const ready = r.ok; await r.body?.cancel(); return ready; }
      catch { signal.throwIfAborted(); lifetime.throwIfAborted(); return false; }
    };
    if (await probe()) return;
    if (!config.whisper.autoStart) throw new Error('本地识别服务没有运行，请启动 whisper.cpp 或配置按需启动');
    if (process.platform !== 'win32') throw new Error('whisper.cpp 按需启动当前支持 Windows');
    if (!this.starting) this.starting = (async () => {
      if (this.child) throw new Error('识别引擎未响应，请稍后重试或重新保存识别设置');
      const executable = await findWhisperEngine(config.whisper.directory); const model = await validateWhisperModel(config.whisper.modelPath);
      signal.throwIfAborted(); lifetime.throwIfAborted();
      const child = spawn(executable, whisperStartArgs(config, model), { cwd: path.dirname(executable), windowsHide: true, shell: false, stdio: 'ignore' });
      this.child = child; let failed = false;
      child.on('error', () => { failed = true; if (this.child === child) this.child = undefined; });
      child.on('exit', () => { failed = true; if (this.child === child) this.child = undefined; });
      try {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          if (failed) throw new Error('Whisper 启动失败，请检查模型下载是否完整、引擎文件及端口');
          if (await probe()) return;
          await delay(250, undefined, { signal: AbortSignal.any([signal, lifetime]) });
        }
        throw new Error('Whisper 模型加载超时，请检查内存与模型文件');
      } catch (error) { if (this.child === child) { child.kill(); this.child = undefined; } throw error; }
    })().finally(() => { this.starting = undefined; });
    await this.starting; signal.throwIfAborted();
  }
  async close() { this.lifetime.abort(); this.child?.kill(); this.child = undefined; await this.starting?.catch(() => {}); this.lifetime = new AbortController(); }
}
