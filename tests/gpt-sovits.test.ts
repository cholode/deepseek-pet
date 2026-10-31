import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { voiceConfigSchema, voiceDefaults } from '../src/shared/voice';
import { VoiceService } from '../src/main/voice/service';
import { VoiceAudio } from '../src/main/voice/audio';
import { findGptSovits, GptSovitsProcess, gptSovitsEndpoint, gptSovitsStartArgs } from '../src/main/voice/gpt-sovits';

const folders: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
async function directory() { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-gpt-')); folders.push(folder); return folder; }
function wav() { const data = new Uint8Array(46); data.set(new TextEncoder().encode('RIFF')); data.set(new TextEncoder().encode('WAVE'), 8); return data; }
const host = { emit: () => {}, seal: async (s: string) => s, unseal: async (s: string) => s };
const legacy = { enabled: false, voice: '', rate: 1, volume: 0.8 };

describe('GPT-SoVITS 本地接入', () => {
  it('启动时静默预热本地模型；首句共用预热、取消首句不打断初始化，退出会取消', async () => {
    const folder = await directory(), file = path.join(folder, 'voice.json'); const config = structuredClone(voiceDefaults);
    config.tts.enabled = true; config.tts.localEngine = 'gpt-sovits'; config.tts.gptSovits.autoStart = true; config.tts.gptSovits.directory = folder;
    await fs.writeFile(file, JSON.stringify({ version: 1, config, sealed: {} }));
    const engine = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const audio = new VoiceAudio(); let release!: () => void; let warmSignal!: AbortSignal;
    const speech = vi.spyOn(audio, 'speakGptSovits').mockImplementation(async (_config, text, signal) => {
      if (text === '你好。') { warmSignal = signal; await new Promise<void>((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(new Error('aborted'))); }); }
      return new ArrayBuffer(44);
    });
    const service = new VoiceService(file, host, audio, undefined, undefined, engine);
    await service.start(legacy); await vi.waitFor(() => expect(speech).toHaveBeenCalledTimes(1)); expect(service.state().preparing).toBe(true);
    const first = service.request({ type: 'speak', text: '上午好。' }, 2, 'pet');
    await service.request({ type: 'cancel', playbackOnly: true }, 2, 'pet'); expect((await first).ok).toBe(false); expect(warmSignal.aborted).toBe(false);
    const next = service.request({ type: 'speak', text: '晚上好。' }, 2, 'pet'); expect(speech).toHaveBeenCalledTimes(1);
    release(); expect((await next).ok).toBe(true); expect(service.state().preparing).toBe(false); await service.close();
    const restart = new VoiceService(file, host, audio, undefined, undefined, engine);
    await restart.start(legacy); await vi.waitFor(() => expect(restart.state().preparing).toBe(true)); await restart.close(); expect(warmSignal.aborted).toBe(true);
  });
  it('中日都走同一音色；每句情绪覆盖参考音，关闭自动情绪后使用手动选择', async () => {
    const folder = await directory(); const payloads: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => { expect(String(url)).toContain('/v1/audio/speech'); payloads.push(JSON.parse(init!.body as string)); return new Response(wav()); });
    const gpt = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) }, vox = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const service = new VoiceService(path.join(folder, 'voice.json'), host, new VoiceAudio(fetcher), vox, undefined, gpt);
    await service.start(legacy); const config = structuredClone(voiceDefaults);
    Object.assign(config.tts, { enabled: true, mode: 'language', languageChinese: 'configured', localEngine: 'gpt-sovits' });
    Object.assign(config.tts.gptSovits, { japanese: true, autoEmotion: true, voice: 'neutral' });
    await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
    for (const language of ['zh', 'ja']) expect((await service.request({ type: 'speak', text: '先生', language, emotion: 'happy' }, 2, 'pet')).ok).toBe(true);
    expect(payloads).toEqual([expect.objectContaining({ language: 'zh', voice: 'happy' }), expect.objectContaining({ language: 'ja', voice: 'happy' })]);
    config.tts.gptSovits.autoEmotion = false;
    await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
    await service.request({ type: 'speak', text: '先生', language: 'ja', emotion: 'sad' }, 2, 'pet');
    expect(payloads.at(-1)).toMatchObject({ language: 'ja', voice: 'neutral' }); expect(vox.ensure).not.toHaveBeenCalled();
    expect((await service.request({ type: 'playback-progress', presentationId: 'a', chunk: 0 }, 1, 'panel')).ok).toBe(false);
    await service.close();
  });
  it('旧中日配置保持微软中文，不激活曾经保存的云端设置', () => {
    const old = structuredClone(voiceDefaults) as unknown as { tts: Record<string, unknown> };
    delete old.tts.gptSovits; delete old.tts.languageChinese; old.tts.mode = 'language'; old.tts.source = 'cloud';
    expect(voiceConfigSchema.parse(old).tts).toMatchObject({ languageChinese: 'system', gptSovits: { autoStart: false } });
  });
  it('固定本机地址和参数，绑定目录必须具备运行环境与桥接配置', async () => {
    expect(() => gptSovitsEndpoint('http://192.168.1.3:9881')).toThrow('本机');
    expect(() => gptSovitsEndpoint('http://127.0.0.1:9881/v1/audio/speech')).toThrow('根地址');
    const folder = await directory(); await expect(findGptSovits(folder)).rejects.toThrow('缺少');
    await fs.mkdir(path.join(folder, '.venv/Scripts'), { recursive: true });
    for (const file of ['.venv/Scripts/python.exe', 'bridge.py', 'runtime.json', 'worker_pool.py']) await fs.writeFile(path.join(folder, file), 'fixture');
    const engine = await findGptSovits(folder);
    expect(gptSovitsStartArgs(voiceDefaults.tts.gptSovits, engine.bridge)).toEqual(['-I', '-X', 'utf8', '-u', engine.bridge, '--host', '127.0.0.1', '--port', '9881', '--threads', '8', '--workers', '2', '--device', 'auto', '--parent-stdin']);
  });
  it('探测服务身份和音色，复用外部服务；关闭宿主不发送关闭外部服务请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ service: 'deepblue-gpt-sovits', protocol: 1, ready: true, voices: [{ id: 'happy', name: '开心' }] }));
    vi.stubGlobal('fetch', fetcher); const engine = new GptSovitsProcess();
    await engine.ensure({ ...voiceDefaults.tts.gptSovits, voice: 'happy' }, new AbortController().signal);
    await expect(engine.ensure(voiceDefaults.tts.gptSovits, new AbortController().signal)).rejects.toThrow('音色不存在');
    await engine.close(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/health'))).toBe(true);
  });
  it('只自动选择已经实测的独立 ROCm 环境，CPU 选项始终保留原环境', async () => {
    const folder = await directory();
    await fs.mkdir(path.join(folder, '.venv/Scripts'), { recursive: true });
    await fs.mkdir(path.join(folder, '.venv-rocm/Scripts'), { recursive: true });
    for (const file of ['.venv/Scripts/python.exe', '.venv-rocm/Scripts/python.exe', 'bridge.py', 'runtime.json', 'worker_pool.py']) await fs.writeFile(path.join(folder, file), 'fixture');
    expect((await findGptSovits(folder)).executable).toBe(path.join(folder, '.venv/Scripts/python.exe'));
    await fs.writeFile(path.join(folder, 'gpu-runtime.json'), JSON.stringify({ schemaVersion: 1, backend: 'rocm', validated: true }));
    expect((await findGptSovits(folder)).executable).toBe(path.join(folder, '.venv-rocm/Scripts/python.exe'));
    expect((await findGptSovits(folder, 'cpu')).executable).toBe(path.join(folder, '.venv/Scripts/python.exe'));
    await fs.writeFile(path.join(folder, 'gpu-runtime.json'), JSON.stringify({ schemaVersion: 1, backend: 'rocm', validated: true, autoDevice: 'cpu' }));
    expect(await findGptSovits(folder)).toMatchObject({ executable: path.join(folder, '.venv/Scripts/python.exe'), gpuRuntime: false });
    expect(await findGptSovits(folder, 'cuda')).toMatchObject({ executable: path.join(folder, '.venv-rocm/Scripts/python.exe'), gpuRuntime: true });
    await fs.unlink(path.join(folder, '.venv-rocm/Scripts/python.exe'));
    await expect(findGptSovits(folder, 'cuda')).rejects.toThrow('GPU 环境缺失');
    expect((await findGptSovits(folder)).executable).toBe(path.join(folder, '.venv/Scripts/python.exe'));
  });
  it('明确选择 GPU 时不能把当前端口的 CPU 服务当作 GPU 成功', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ service: 'deepblue-gpt-sovits', protocol: 1, ready: true, device: 'cpu', voices: [{ id: 'neutral', name: '中立' }] }));
    vi.stubGlobal('fetch', fetcher); const engine = new GptSovitsProcess();
    await expect(engine.ensure({ ...voiceDefaults.tts.gptSovits, device: 'cuda' }, new AbortController().signal)).rejects.toThrow('没有使用 GPU');
    await engine.close();
  });
  it('中文走本机音色接口，日文保持 VOICEVOX，原语音密钥不发送到桥接', async () => {
    const folder = await directory(); const payloads: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/speakers')) return Response.json([{ name: '雨晴はう', styles: [{ name: 'ノーマル', id: 10 }] }]);
      if (String(url).includes('/audio_query')) return Response.json({ accent_phrases: [], speedScale: 1 });
      if (String(url).includes('/v1/audio/speech')) { payloads.push(JSON.parse(init!.body as string)); expect(init?.headers).not.toHaveProperty('Authorization'); }
      return new Response(wav());
    });
    const engine = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const vox = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const service = new VoiceService(path.join(folder, 'voice.json'), host, new VoiceAudio(fetcher), vox, undefined, engine);
    await service.start(legacy); const config = structuredClone(voiceDefaults);
    config.tts.enabled = true; config.tts.mode = 'language'; config.tts.languageChinese = 'configured'; config.tts.localEngine = 'gpt-sovits'; config.tts.gptSovits.voice = 'happy';
    expect((await service.request({ type: 'configure', config, secrets: { ttsLocal: 'unrelated-secret' } }, 1, 'panel')).ok).toBe(true);
    expect((await service.request({ type: 'speak', text: '这是我的声音', language: 'zh' }, 2, 'pet')).audio).toBeInstanceOf(ArrayBuffer);
    expect((await service.request({ type: 'speak', text: 'こんにちは', language: 'ja' }, 2, 'pet')).audio).toBeInstanceOf(ArrayBuffer);
    expect(payloads).toEqual([{ model: 'gpt-sovits-v2proplus', input: '这是我的声音', language: 'zh', voice: 'happy', speed: 1, response_format: 'wav' }]);
    expect(engine.ensure).toHaveBeenCalledTimes(1); expect(vox.ensure).toHaveBeenCalledTimes(1);
    expect((await service.request({ type: 'gpt-sovits-check' }, 2, 'pet')).ok).toBe(false);
    expect((await service.request({ type: 'gpt-sovits-directory' }, 2, 'chat')).ok).toBe(false);
    await service.close(); expect(engine.close).toHaveBeenCalledTimes(2);
  });
  it('启动模型期间取消，不提交迟到音频，保存配置和退出关闭自己拥有的引擎', async () => {
    const folder = await directory(); let cancel!: () => void;
    const engine = { ensure: vi.fn(async (_config, signal: AbortSignal) => { await new Promise<void>(resolve => { cancel = resolve; }); signal.throwIfAborted(); }), close: vi.fn(async () => {}) };
    const fetcher = vi.fn<typeof fetch>();
    const service = new VoiceService(path.join(folder, 'voice.json'), host, new VoiceAudio(fetcher), undefined, undefined, engine);
    await service.start(legacy); const config = structuredClone(voiceDefaults); config.tts.localEngine = 'gpt-sovits';
    await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
    const pending = service.request({ type: 'speak', text: '测试取消', test: true }, 1, 'panel');
    await service.request({ type: 'cancel', playbackOnly: true }, 1, 'panel'); cancel();
    expect((await pending).ok).toBe(false); expect(fetcher).not.toHaveBeenCalled(); await service.close();
  });
  it('同一播放批次的中文和日文可同时计算，取消一起生效且不会取消下一批次', async () => {
    const folder = await directory(); const signals: AbortSignal[] = []; const releases: (() => void)[] = [];
    const engine = { ensure: vi.fn(async (_config, signal: AbortSignal) => { signals.push(signal); await new Promise<void>(resolve => releases.push(resolve)); signal.throwIfAborted(); }), close: vi.fn(async () => {}) };
    const service = new VoiceService(path.join(folder, 'voice.json'), host, new VoiceAudio(vi.fn()), engine, undefined, engine);
    await service.start(legacy); const config = structuredClone(voiceDefaults);
    config.tts.enabled = true; config.tts.mode = 'language'; config.tts.languageChinese = 'configured'; config.tts.localEngine = 'gpt-sovits';
    await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
    const request = (language: 'zh' | 'ja', playbackId: string) => service.request({ type: 'speak', text: '测试', language, playbackId }, 2, 'pet');
    const first = randomUUID(), second = randomUUID();
    const chinese = request('zh', first); const japanese = request('ja', first);
    expect(signals).toHaveLength(2); expect(signals.every(signal => !signal.aborted)).toBe(true);
    const next = request('zh', second);
    await service.request({ type: 'cancel', playbackOnly: true, playbackId: first }, 2, 'pet');
    expect(signals.map(signal => signal.aborted)).toEqual([true, true, false]);
    await service.request({ type: 'cancel', playbackOnly: true }, 2, 'pet');
    releases.forEach(release => release());
    expect((await Promise.all([chinese, japanese, next])).every(response => !response.ok)).toBe(true);
    await service.close();
  });
});
