import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VoiceAudio, validateRecording, voiceEndpoint } from '../src/main/voice/audio';
import { VoiceService } from '../src/main/voice/service';
import { encodeVoiceWav } from '../src/shared/voice-wav';
import { maxRecordingBytes, speechChunks, speechText, voiceDefaults, voiceRequestSchema, type VoiceEvent } from '../src/shared/voice';

const folders: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });
const wav = () => encodeVoiceWav(Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i / 20) * 0.1));
const legacy = { enabled: false, voice: '', rate: 1, volume: 0.8 };
async function fixture(fetcher?: typeof fetch) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-voice-')); folders.push(folder); const file = path.join(folder, 'voice.json'); const events: VoiceEvent[] = [];
  const host = { emit: (event: VoiceEvent) => events.push(event), seal: vi.fn(async (value: string) => Buffer.from(value).toString('base64')), unseal: vi.fn(async (value: string) => Buffer.from(value, 'base64').toString()) };
  const service = new VoiceService(file, host, new VoiceAudio(fetcher)); await service.start(legacy);
  return { file, host, events, service };
}
const configure = (service: VoiceService, config = structuredClone(voiceDefaults), secrets = {}) => service.request({ type: 'configure', config, secrets }, 1, 'panel');

describe('voice protocol and audio', () => {
  it('defaults to offline, opt-in voice and keeps cloud separate', () => { expect(voiceDefaults.tts.source).toBe('local'); expect(voiceDefaults.tts.enabled).toBe(false); expect(voiceDefaults.asr.enabled).toBe(false); });
  it.each(['http://example.com/inference', 'http://192.168.1.1/inference', 'file:///tmp/x', 'http://localhost@evil.com/x'])('rejects non-loopback local endpoint %s', url => { expect(() => voiceEndpoint(url, 'local')).toThrow(); });
  it('requires HTTPS and separate credential fields for cloud', () => { expect(() => voiceEndpoint('http://example.com/audio', 'cloud')).toThrow(); expect(() => voiceEndpoint('https://example.com/audio?key=secret', 'cloud')).toThrow(); expect(() => voiceEndpoint('https://user:secret@example.com/audio', 'cloud')).toThrow(); expect(voiceEndpoint('http://[::1]:8080/inference', 'local').hostname).toBe('[::1]'); });
  it('encodes bounded PCM and rejects malformed recordings at IPC and adapter', () => {
    const audio = encodeVoiceWav(new Float32Array([-2, -1, 0, 1, 2])); validateRecording(audio);
    expect(new DataView(audio).getInt16(44, true)).toBe(-32768); expect(new DataView(audio).getInt16(52, true)).toBe(32767);
    expect(() => validateRecording(new ArrayBuffer(48))).toThrow();
    expect(voiceRequestSchema.safeParse({ type: 'transcribe', captureId: '00000000-0000-4000-8000-000000000000', audio: new ArrayBuffer(maxRecordingBytes + 1) }).success).toBe(false);
  });
  it('removes image URLs/code and chunks without dropping Japanese or splitting surrogate pairs', () => {
    const text = '# こんにちは **世界** [例](https://example.com) ![表情](petsticker://local/x)\n```js\nsecret\n```';
    expect(speechText(text)).toBe('こんにちは 世界 例');
    const long = '今日はいい天気です。🐟'.repeat(220); const chunks = speechChunks(long); expect(chunks.length).toBeGreaterThan(1); expect(chunks.join('')).toBe(long); expect(chunks.every(c => Array.from(c).length <= 1000 && !c.endsWith('\ud83d'))).toBe(true);
  });
  it('sends TTS JSON and returns WAV with redirect refusal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(wav())); const config = structuredClone(voiceDefaults.tts); config.source = 'cloud';
    const audio = await new VoiceAudio(fetcher).speak(config, 'こんにちは', 'tts-key', new AbortController().signal);
    validateRecording(audio); const [url, request] = fetcher.mock.calls[0]; expect(String(url)).toBe(config.cloud.url); expect(request?.redirect).toBe('error');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer tts-key' }); expect(JSON.parse(request?.body as string)).toMatchObject({ input: 'こんにちは', model: config.cloud.model, voice: 'coral', response_format: 'wav' });
  });
  it.each(['local', 'cloud'] as const)('uploads real WAV multipart for %s compatible recognition', async source => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: '  日本語の練習です。 ' })); const config = structuredClone(voiceDefaults.asr); config.source = source; config[source].model = 'my-asr'; config.language = 'ja';
    expect(await new VoiceAudio(fetcher).transcribe(config, wav(), 'asr-key', new AbortController().signal)).toBe('日本語の練習です。');
    const request = fetcher.mock.calls[0][1]!; const form = request.body as FormData;
    expect(form.get('model')).toBe('my-asr'); expect(form.get('language')).toBe('ja'); expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File; expect(file.name).toBe('recording.wav'); expect(file.type).toBe('audio/wav'); validateRecording(await file.arrayBuffer());
    expect(request.headers).toEqual({ Authorization: 'Bearer asr-key' });
  });
  it('uses whisper.cpp protocol without a fictitious model field', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: '你好' })); const config = structuredClone(voiceDefaults.asr); config.localProtocol = 'whisper-cpp'; config.local.url = 'http://127.0.0.1:8080/inference';
    await new VoiceAudio(fetcher).transcribe(config, wav(), '', new AbortController().signal); const form = fetcher.mock.calls[0][1]!.body as FormData;
    expect(form.has('model')).toBe(false); expect(form.get('language')).toBe('auto');
  });
  it('does not echo service error bodies or accept non-audio TTS', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('secret-key', { status: 401 })).mockResolvedValueOnce(new Response('not an audio file'));
    const config = structuredClone(voiceDefaults.tts); config.source = 'cloud'; const audio = new VoiceAudio(fetcher);
    await expect(audio.speak(config, 'test', '', new AbortController().signal)).rejects.toThrow('HTTP 401');
    await expect(audio.speak(config, 'test', '', new AbortController().signal)).rejects.toThrow('WAV');
  });
  it('rejects oversized responses and empty transcription', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(30 * 1024 * 1024) } })).mockResolvedValueOnce(Response.json({ text: ' ' }));
    const audio = new VoiceAudio(fetcher); const tts = structuredClone(voiceDefaults.tts); tts.source = 'cloud';
    await expect(audio.speak(tts, 'test', '', new AbortController().signal)).rejects.toThrow('过大');
    await expect(audio.transcribe({ ...voiceDefaults.asr, source: 'cloud' }, wav(), '', new AbortController().signal)).rejects.toThrow('没有识别到');
  });
});

describe('voice service lifecycle and secrets', () => {
  it('migrates legacy speech once and keeps subsequent conversation settings authoritative', async () => {
    const { file, host } = await fixture(); await fs.unlink(file); const service = new VoiceService(file, host); await service.start({ ...legacy, enabled: true, voice: 'Japanese', rate: 1.2 });
    expect(service.state().config.tts).toMatchObject({ enabled: true, systemVoice: 'Japanese', rate: 1.2 });
    const reload = new VoiceService(file, host); await reload.start(legacy); expect(reload.state().config.tts.enabled).toBe(true);
  });
  it('seals four separate credentials, returns only flags, retains and clears explicitly', async () => {
    const { file, host, service } = await fixture(); expect((await configure(service, voiceDefaults, { ttsCloud: 'unique-tts-key', asrCloud: 'unique-asr-key' })).ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).not.toContain('unique-tts-key'); expect(JSON.stringify(service.state())).not.toContain('unique-asr-key'); expect(host.seal).toHaveBeenCalledTimes(2);
    await configure(service); expect(service.state().hasSecrets.ttsCloud).toBe(true); await configure(service, voiceDefaults, { ttsCloud: '' });
    const reload = new VoiceService(file, host); await reload.start(legacy); expect(reload.state().hasSecrets).toMatchObject({ ttsCloud: false, asrCloud: true });
  });
  it('encryption failure leaves config and disk untouched', async () => {
    const { file, host, service } = await fixture(); const before = await fs.readFile(file, 'utf8'); host.seal.mockRejectedValue(new Error('encryption unavailable'));
    const config = structuredClone(voiceDefaults); config.asr.enabled = true; expect((await configure(service, config, { asrCloud: 'x' })).ok).toBe(false); expect(await fs.readFile(file, 'utf8')).toBe(before); expect(service.state().config.asr.enabled).toBe(false);
  });
  it('waits for an in-flight encrypted save before closing', async () => {
    const { file, host, service } = await fixture(); let release!: () => void;
    host.seal.mockImplementation(async value => { await new Promise<void>(resolve => { release = resolve; }); return Buffer.from(value).toString('base64'); });
    const pending = configure(service, voiceDefaults, { asrCloud: 'saved-on-close' }); let closed = false;
    const closing = service.close().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false); release();
    expect((await pending).ok).toBe(true); await closing; const reload = new VoiceService(file, host); await reload.start(legacy); expect(reload.state().hasSecrets.asrCloud).toBe(true);
  });
  it('restricts management, microphone and synthesis by window role', async () => {
    const { service } = await fixture(); expect((await service.request({ type: 'configure', config: voiceDefaults, secrets: {} }, 2, 'chat')).ok).toBe(false);
    expect((await service.request({ type: 'speak', text: 'hello' }, 2, 'chat')).ok).toBe(false); expect((await service.request({ type: 'capture-begin' }, 1, 'panel')).ok).toBe(false);
    const config = structuredClone(voiceDefaults); config.asr.enabled = true; await configure(service, config);
    expect((await service.request({ type: 'capture-begin' }, 3, 'pet')).ok).toBe(false);
    expect((await service.request({ type: 'speak', text: 'hello', test: true }, 3, 'pet')).ok).toBe(false);
  });
  it('grants a single capture lease, validates owner, revokes on finish and prevents replay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: '猫' })); const { service, events } = await fixture(fetcher);
    const config = structuredClone(voiceDefaults); config.asr.enabled = true; config.asr.localProtocol = 'whisper-cpp'; await configure(service, config);
    const begin = await service.request({ type: 'capture-begin' }, 2, 'chat'); expect(begin.ok).toBe(true); expect(service.permitsCapture(2)).toBe(true); expect(service.permitsCapture(1)).toBe(false); expect(events.at(-1)?.type).toBe('stop-playback');
    expect((await service.request({ type: 'capture-begin' }, 1, 'panel')).ok).toBe(false);
    const request = { type: 'transcribe', captureId: begin.captureId, audio: wav() };
    expect((await service.request(request, 1, 'panel')).ok).toBe(false); expect((await service.request(request, 2, 'chat')).text).toBe('猫');
    expect(service.permitsCapture(2)).toBe(false); expect((await service.request(request, 2, 'chat')).ok).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('expires microphone permission and cancels it on save', async () => {
    const { service } = await fixture(); const config = structuredClone(voiceDefaults); config.asr.enabled = true; await configure(service, config);
    await service.request({ type: 'capture-begin' }, 1, 'panel'); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 91000); expect(service.permitsCapture(1)).toBe(false); vi.useRealTimers();
    service.cancel(1); await service.request({ type: 'capture-begin' }, 1, 'panel'); await configure(service, config); expect(service.permitsCapture(1)).toBe(false);
  });
  it('cancels in-flight network synthesis and can make the next request', async () => {
    let aborted = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce((_url, request) => new Promise((_resolve, reject) => { request?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }); })).mockResolvedValueOnce(new Response(wav()));
    const { service } = await fixture(fetcher); const config = structuredClone(voiceDefaults); config.tts.enabled = true; config.tts.source = 'cloud'; await configure(service, config);
    const pending = service.request({ type: 'speak', text: 'hello' }, 3, 'pet'); service.stopAll(); expect((await pending).message).toContain('取消'); expect(aborted).toBe(true);
    expect((await service.request({ type: 'speak', text: 'next' }, 3, 'pet')).audio).toBeInstanceOf(ArrayBuffer);
  });
});
