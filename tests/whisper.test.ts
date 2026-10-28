import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findWhisperEngine, validateWhisperModel, whisperStartArgs } from '../src/main/voice/whisper';
import { VoiceService } from '../src/main/voice/service';
import { VoiceAudio } from '../src/main/voice/audio';
import { voiceConfigSchema, voiceDefaults } from '../src/shared/voice';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(f => fs.rm(f, { recursive: true, force: true }))); });
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-whisper-')); folders.push(folder);
  const engine = path.join(folder, 'Release'); await fs.mkdir(engine); await fs.writeFile(path.join(engine, 'whisper-server.exe'), 'fixture - never executed');
  const model = path.join(folder, 'ggml-test.bin'); const bytes = Buffer.alloc(1024 * 1024); bytes.writeUInt32LE(0x67676d6c); await fs.writeFile(model, bytes);
  const whisper = { ensure: vi.fn(async (_config: unknown, _signal: AbortSignal) => {}), close: vi.fn(async () => {}) };
  const audio = new VoiceAudio(); const service = new VoiceService(path.join(folder, 'settings.json'), { emit: () => {}, seal: async v => v, unseal: async v => v }, audio, { ensure: async () => {}, close: async () => {} }, whisper);
  await service.start({ enabled: false, voice: '', rate: 1, volume: 1 });
  const config = structuredClone(voiceDefaults); config.asr.enabled = true; config.asr.localProtocol = 'whisper-cpp'; config.asr.local.url = 'http://127.0.0.1:8080/inference'; config.asr.whisper = { directory: folder, modelPath: model, autoStart: true, cpuThreads: 8 };
  return { folder, model, config, service, whisper, audio };
}
describe('本地识别启动与错误', () => {
  it('旧配置保持原识别协议，按需启动默认关闭', () => {
    const old = JSON.parse(JSON.stringify(voiceDefaults)); delete old.asr.whisper;
    expect(voiceConfigSchema.parse(old).asr).toMatchObject({ localProtocol: 'compatible', whisper: { autoStart: false } });
  });
  it('只接受已选择的固定程序与 GGML 模型，启动参数不能成为命令', async () => {
    const f = await fixture(); expect(await findWhisperEngine(f.folder)).toBe(path.join(f.folder, 'Release', 'whisper-server.exe'));
    expect(await validateWhisperModel(f.model)).toBe(f.model);
    const args = whisperStartArgs(f.config.asr, f.model); expect(args).toContain('--no-gpu'); expect(args).toContain(f.model); expect(args).toEqual(expect.arrayContaining(['--max-context', '0', '--threads', '8']));
    await expect(validateWhisperModel('relative.bin')).rejects.toThrow('本机'); await fs.writeFile(f.model, Buffer.alloc(1024 * 1024)); await expect(validateWhisperModel(f.model)).rejects.toThrow('GGML');
    expect(() => whisperStartArgs({ ...f.config.asr, local: { url: 'https://example.com/inference', model: '' } }, f.model)).toThrow(); await f.service.close();
  });
  it('识别模型为空时录音前明确报错，未授予麦克风权限', async () => {
    const f = await fixture(); const config = structuredClone(voiceDefaults); config.asr.enabled = true;
    await f.service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
    expect((await f.service.request({ type: 'capture-begin' }, 1, 'panel')).message).toContain('识别尚未配置'); expect(f.service.permitsCapture(1)).toBe(false); await f.service.close();
  });
  it('加载模型期间没有麦克风权限，可取消且迟到结果不重开录音', async () => {
    const f = await fixture(); expect((await f.service.request({ type: 'configure', config: f.config, secrets: {} }, 1, 'panel')).ok).toBe(true);
    let finish!: () => void; f.whisper.ensure.mockImplementationOnce(async () => new Promise<void>(resolve => { finish = resolve; }));
    const pending = f.service.request({ type: 'capture-begin' }, 1, 'panel'); await vi.waitFor(() => expect(f.whisper.ensure).toHaveBeenCalled()); expect(f.service.permitsCapture(1)).toBe(false);
    await f.service.request({ type: 'cancel' }, 1, 'panel'); finish(); expect((await pending).message).toContain('取消'); expect(f.service.permitsCapture(1)).toBe(false);
    expect((await f.service.request({ type: 'capture-begin' }, 1, 'panel')).ok).toBe(true); expect(f.service.permitsCapture(1)).toBe(true); await f.service.close(); expect(f.whisper.close).toHaveBeenCalled();
  });
  it('识别引擎启动失败不留下占用，下一次可恢复', async () => {
    const f = await fixture(); await f.service.request({ type: 'configure', config: f.config, secrets: {} }, 1, 'panel');
    f.whisper.ensure.mockRejectedValueOnce(new Error('模型损坏'));
    expect((await f.service.request({ type: 'capture-begin' }, 1, 'panel')).message).toBe('模型损坏');
    expect((await f.service.request({ type: 'capture-begin' }, 1, 'panel')).ok).toBe(true); await f.service.close();
  });
  it('检查服务仅允许小屋，失败提示识别地址而非静默等待', async () => {
    const f = await fixture(); f.config.asr.localProtocol = 'compatible'; f.config.asr.local.model = 'test'; await f.service.request({ type: 'configure', config: f.config, secrets: {} }, 1, 'panel');
    vi.spyOn(f.audio, 'checkAsr').mockRejectedValue(new TypeError('fetch failed'));
    expect((await f.service.request({ type: 'asr-check' }, 2, 'chat')).ok).toBe(false);
    expect((await f.service.request({ type: 'asr-check' }, 1, 'panel')).message).toContain('无法连接识别服务'); await f.service.close();
  });
});
