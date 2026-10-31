import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VoicePlayer } from '../src/renderer/voice/player';
import { VoiceService } from '../src/main/voice/service';
import { VoiceAudio } from '../src/main/voice/audio';
import { voicevoxStartArgs } from '../src/main/voice/voicevox';
import { speechChunks, voiceConfigSchema, voiceDefaults, type VoiceRequest, type VoiceResponse } from '../src/shared/voice';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function playback(concurrency = 1) {
  const requests: Extract<VoiceRequest, { type: 'speak' }>[] = [];
  const replies: ((response: VoiceResponse) => void)[] = [];
  const played: MockAudio[] = [];
  class MockAudio {
    onended?: () => void; onerror?: () => void; onplaying?: () => void; volume = 1;
    pause = vi.fn(); play = vi.fn(async () => { played.push(this); });
  }
  const voice = vi.fn((request: VoiceRequest): Promise<VoiceResponse> => {
    if (request.type === 'state') { const config = structuredClone(voiceDefaults); config.tts.synthesisConcurrency = concurrency; return Promise.resolve({ ok: true, state: { config, hasSecrets: { ttsLocal: false, ttsCloud: false, asrLocal: false, asrCloud: false } } }); }
    if (request.type !== 'speak') return Promise.resolve({ ok: true });
    requests.push(request); return new Promise(resolve => replies.push(resolve));
  });
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('window', { pet: { voice }, speechSynthesis: { cancel: vi.fn() } });
  return { player: new VoicePlayer(), requests, replies, played, voice };
}
const audio = (): VoiceResponse => ({ ok: true, audio: new ArrayBuffer(44) });

describe('逐句预合成', () => {
  it('流式完整句立即合成；两句并发、乱序完成仍按序播放，结尾不重读', async () => {
    const f = playback(2), starts = vi.fn(); const stream = f.player.begin(starts);
    stream.update('第一句。后半句还没结束', [{ text: '第一句。', language: 'zh' }]);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    stream.update('第一句。第二句。', [{ text: '第一句。第二句。', language: 'zh' }]);
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    expect(f.requests.map(r => r.chunk)).toEqual([0, 1]);
    f.replies[1](audio()); await Promise.resolve(); expect(f.played).toHaveLength(0);
    f.replies[0](audio()); await vi.waitFor(() => expect(f.played).toHaveLength(1));
    f.played[0].onplaying?.(); expect(starts.mock.calls).toEqual([[0]]);
    stream.update('第一句。第二句。', [{ text: '第一句。第二句。', language: 'zh' }], true);
    f.played[0].onended?.(); await vi.waitFor(() => expect(f.played).toHaveLength(2));
    f.played[1].onplaying?.(); f.played[1].onended?.(); await stream.done;
    expect(starts.mock.calls).toEqual([[0], [1]]); expect(f.requests).toHaveLength(2);
  });
  it('停止空队列立即完成，迟到句子不能复活已取消的流', async () => {
    const f = playback(2), stream = f.player.begin();
    await Promise.resolve(); f.player.stop(); await stream.done;
    stream.update('迟到。', undefined, true); expect(f.requests).toHaveLength(0);
  });
  it('只有实际开始播放才通知显示句子，预取就绪及取消后的迟到事件不推进', async () => {
    const f = playback(), starts = vi.fn(); const pending = f.player.speak('第一句。第二句。', false, undefined, undefined, starts);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); expect(starts).not.toHaveBeenCalled();
    f.replies[0](audio()); await vi.waitFor(() => expect(f.played).toHaveLength(1)); expect(starts).not.toHaveBeenCalled();
    f.played[0].onplaying?.(); f.played[0].onplaying?.(); expect(starts.mock.calls).toEqual([[0]]);
    f.replies[1](audio()); await Promise.resolve(); expect(starts.mock.calls).toEqual([[0]]);
    f.player.stop(); f.played[0].onplaying?.(); await pending; expect(starts.mock.calls).toEqual([[0]]);
  });
  it('按句界拆分、保留引号，清理 Markdown，不拆小数和 Unicode 字符', () => {
    expect(speechChunks('**你好。**「こんにちは！」下一句。Value 3.14 is fine. Next!')).toEqual(['你好。', '「こんにちは！」', '下一句。', 'Value 3.14 is fine.', ' Next!']);
    const long = '🐟'.repeat(400); const chunks = speechChunks(long); expect(chunks.map(c => Array.from(c).length)).toEqual([180, 180, 40]); expect(chunks.join('')).toBe(long);
    expect(speechChunks('```ts\nignored();\n```')).toEqual([]);
  });
  it('首句不等后句；合成与播放重叠、最多预取一句，停止丢弃迟到音频', async () => {
    const f = playback(); const pending = f.player.speak('一句。二句。三句。四句。');
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); expect(f.played).toHaveLength(0);
    f.replies[0](audio()); await vi.waitFor(() => expect(f.played).toHaveLength(1));
    expect(f.requests.map(r => r.text)).toEqual(['一句。', '二句。']);
    f.replies[1](audio()); await Promise.resolve(); expect(f.played).toHaveLength(1); expect(f.requests).toHaveLength(2);
    f.played[0].onended?.(); await vi.waitFor(() => expect(f.played).toHaveLength(2));
    expect(f.requests.map(r => r.text)).toEqual(['一句。', '二句。', '三句。']);
    expect(new Set(f.requests.map(r => r.playbackId)).size).toBe(1);
    f.player.stop(); await pending; expect(f.played[1].pause).toHaveBeenCalled();
    expect(f.voice).toHaveBeenCalledWith({ type: 'cancel', playbackOnly: true, playbackId: f.requests[0].playbackId });
    f.replies[2](audio()); await Promise.resolve(); expect(f.played).toHaveLength(2); expect(f.requests).toHaveLength(3);
  });
  it('合成慢于播放时等待下一句，兼容拒绝同时合成两句的引擎', async () => {
    const f = playback(); const pending = f.player.speak('一。二。三。');
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); f.replies[0](audio());
    await vi.waitFor(() => expect(f.played).toHaveLength(1)); f.played[0].onended?.();
    await Promise.resolve(); expect(f.requests).toHaveLength(2); expect(f.played).toHaveLength(1);
    f.replies[1](audio()); await vi.waitFor(() => expect(f.played).toHaveLength(2)); expect(f.requests).toHaveLength(3);
    f.replies[2](audio()); f.played[1].onended?.(); await vi.waitFor(() => expect(f.played).toHaveLength(3)); f.played[2].onended?.(); await pending;
  });
  it('后句合成失败在轮到它时报告，并取消整个批次，不再请求更多句', async () => {
    const f = playback(); const result = f.player.speak('一。二。三。').catch((error: Error) => error.message);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); f.replies[0](audio());
    await vi.waitFor(() => expect(f.played).toHaveLength(1)); f.replies[1]({ ok: false, message: '引擎不可用' });
    await Promise.resolve(); expect(f.played).toHaveLength(1); f.played[0].onended?.(); expect(await result).toBe('引擎不可用'); expect(f.requests).toHaveLength(2);
  });
  it('旧批次响应迟到不覆盖新批次，停止新批次使用自己的标识', async () => {
    const f = playback(); const old = f.player.speak('旧句。'); await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.player.stop(); const current = f.player.speak('新句。'); await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.replies[0](audio()); await old; expect(f.played).toHaveLength(0);
    f.replies[1](audio()); await vi.waitFor(() => expect(f.played).toHaveLength(1)); f.player.stop(); await current;
    const cancelled = f.voice.mock.calls.flatMap(([r]) => r.type === 'cancel' ? [r.playbackId] : []);
    expect(cancelled).toEqual(f.requests.map(r => r.playbackId)); expect(cancelled[0]).not.toBe(cancelled[1]);
  });
});

describe('设备与取消边界', () => {
  it('旧配置兼容，CPU 自动线程有上限，GPU 与显式线程通过固定参数传递', () => {
    const config = structuredClone(voiceDefaults.tts.voicevox);
    expect(voicevoxStartArgs(config, 16)).toContain('--no-use_gpu'); expect(voicevoxStartArgs(config, 16)).toContain('8');
    expect(voicevoxStartArgs(config, 128)).toContain('16'); expect(voicevoxStartArgs(config, 1)).toContain('1');
    expect(voicevoxStartArgs({ ...config, device: 'gpu', cpuThreads: 12 }, 16)).toEqual(expect.arrayContaining(['--use_gpu', '--cpu_num_threads', '12']));
    const legacy = JSON.parse(JSON.stringify(voiceDefaults)); delete legacy.tts.voicevox.device; delete legacy.tts.voicevox.cpuThreads;
    expect(voiceConfigSchema.parse(legacy).tts.voicevox).toMatchObject({ device: 'cpu', cpuThreads: 0 });
    legacy.tts.voicevox.cpuThreads = -1; expect(voiceConfigSchema.safeParse(legacy).success).toBe(false);
  });
  it('按窗口和批次取消；旧取消不伤及新批次，全部停止仍取消所有合成', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pipeline-'));
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, request) => new Promise((_resolve, reject) => { const signal = request!.signal!; signals.push(signal); signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
    const service = new VoiceService(path.join(folder, 'voice.json'), { emit: () => {}, seal: async v => v, unseal: async v => v }, new VoiceAudio(fetcher));
    try {
      await service.start({ enabled: false, voice: '', rate: 1, volume: 1 });
      const config = structuredClone(voiceDefaults); config.tts.enabled = true; config.tts.localEngine = 'http';
      config.tts.local.model = 'fixture'; config.tts.local.voice = 'fixture';
      await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel');
      const a = crypto.randomUUID(), b = crypto.randomUUID();
      const old = service.request({ type: 'speak', text: '旧', playbackId: a }, 3, 'pet');
      const current = service.request({ type: 'speak', text: '新', playbackId: b }, 3, 'pet');
      const parallel = service.request({ type: 'speak', text: '新第二句', playbackId: b, chunk: 1 }, 3, 'pet');
      expect(signals.every(s => !s.aborted)).toBe(true);
      await service.request({ type: 'cancel', playbackOnly: true, playbackId: a }, 4, 'pet'); expect(signals.every(s => !s.aborted)).toBe(true);
      await service.request({ type: 'cancel', playbackOnly: true, playbackId: a }, 3, 'pet'); expect((await old).ok).toBe(false); expect(signals[1].aborted).toBe(false);
      service.stopAll(); expect((await current).message).toContain('取消'); expect((await parallel).message).toContain('取消'); expect(signals.slice(1).every(s => s.aborted)).toBe(true);
    } finally { await service.close(); await fs.rm(folder, { recursive: true, force: true }); }
  });
});
