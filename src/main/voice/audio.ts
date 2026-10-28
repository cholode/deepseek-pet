import type { VoiceConfig } from '../../shared/voice';
import { z } from 'zod';

export function voiceEndpoint(raw: string, source: 'local' | 'cloud'): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new Error('请填写完整的语音接口地址'); }
  if (url.username || url.password || url.hash || url.search) throw new Error('语音地址不能包含凭证、查询参数或片段；密钥请填入独立输入框');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (source === 'local' ? !local || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:' || local) throw new Error(source === 'local' ? '本地语音服务仅允许本机回环地址' : '云端语音服务需要 HTTPS 地址');
  return url;
}
export function validateVoiceConfig(config: VoiceConfig) {
  for (const kind of ['tts', 'asr'] as const) for (const source of ['local', 'cloud'] as const) if (config[kind][source].url) voiceEndpoint(config[kind][source].url, source);
  const vox = voiceEndpoint(config.tts.voicevox.url, 'local');
  if (vox.pathname !== '/') throw new Error('VOICEVOX 地址只填写本机地址和端口');
  if (config.tts.mode === 'language' && config.tts.voicevox.autoStart && !config.tts.voicevox.directory) throw new Error('请先选择 VOICEVOX 目录，或关闭按需启动');
  if (config.tts.voicevox.autoStart && vox.protocol !== 'http:') throw new Error('按需启动 VOICEVOX 请使用本机 HTTP 地址');
}
async function bounded(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`语音服务返回 HTTP ${response.status}；请检查服务、模型与密钥`); }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('语音服务响应过大'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('语音服务返回空响应');
  const parts: Uint8Array[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maximum) throw new Error('语音服务响应过大'); parts.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
export function validateRecording(audio: ArrayBuffer) {
  const view = new DataView(audio); const bytes = new Uint8Array(audio); const word = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (audio.byteLength <= 44 || word(0) !== 'RIFF' || word(8) !== 'WAVE' || word(12) !== 'fmt ' || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint16(34, true) !== 16 || word(36) !== 'data' || view.getUint32(40, true) !== audio.byteLength - 44) throw new Error('录音必须是 16 kHz 单声道 PCM WAV');
}
export class VoiceAudio {
  constructor(private fetcher: typeof fetch = fetch) {}
  async checkAsr(config: VoiceConfig['asr'], key: string, signal: AbortSignal) {
    const service = config[config.source]; const url = voiceEndpoint(service.url, config.source);
    const response = await this.fetcher(url, { method: 'OPTIONS', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]), headers: key ? { Authorization: `Bearer ${key}` } : {} });
    await response.body?.cancel();
    if (!response.ok && response.status !== 405) throw new Error(`识别接口返回 HTTP ${response.status}，请检查地址、模型与密钥`);
  }
  async voicevoxSpeaker(url: string, signal: AbortSignal): Promise<number> {
    const root = voiceEndpoint(url, 'local');
    const response = await this.fetcher(new URL('speakers', root), { redirect: 'error', signal });
    const bytes = await bounded(response, 2 * 1024 * 1024);
    const schema = z.array(z.object({ name: z.string(), styles: z.array(z.object({ name: z.string(), id: z.number().int().nonnegative(), type: z.string().optional() })) }));
    let speakers: z.infer<typeof schema>;
    try { speakers = schema.parse(JSON.parse(new TextDecoder().decode(bytes))); } catch { throw new Error('VOICEVOX 没有返回有效的角色列表'); }
    // 0.26 的说话模型标为 streaming_talk；排除同名的歌唱 / frame_decode 风格。
    const style = speakers.find(speaker => speaker.name === '雨晴はう')?.styles.find(style => style.name === 'ノーマル' && (!style.type || ['talk', 'streaming_talk'].includes(style.type)));
    if (!style) throw new Error('此 VOICEVOX 中没有雨晴はう的普通说话音色，请检查安装版本');
    return style.id;
  }
  async speakJapanese(config: VoiceConfig['tts'], text: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const root = voiceEndpoint(config.voicevox.url, 'local'); const speaker = await this.voicevoxSpeaker(config.voicevox.url, signal);
    const queryUrl = new URL('audio_query', root); queryUrl.searchParams.set('speaker', String(speaker)); queryUrl.searchParams.set('text', text);
    const queryResponse = await this.fetcher(queryUrl, { method: 'POST', redirect: 'error', signal });
    const bytes = await bounded(queryResponse, 2 * 1024 * 1024);
    let query: Record<string, unknown>;
    try { query = z.object({ accent_phrases: z.array(z.unknown()), speedScale: z.number() }).passthrough().parse(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new Error('VOICEVOX 未返回有效的语音参数'); }
    const url = new URL('synthesis', root); url.searchParams.set('speaker', String(speaker));
    const response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...query, speedScale: config.rate, volumeScale: 1, outputStereo: false }) });
    return this.wav(await bounded(response, 20 * 1024 * 1024));
  }
  private wav(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
    if (bytes.length < 12 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WAVE') throw new Error('TTS 服务未返回 WAV 音频，请检查接口兼容性');
    return bytes.buffer;
  }
  async speak(config: VoiceConfig['tts'], text: string, key: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const service = config[config.source]; const url = voiceEndpoint(service.url, config.source);
    if (!service.model || !service.voice) throw new Error('请填写 TTS 模型和声音 ID');
    const response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: service.model, input: text, voice: service.voice, speed: config.rate, response_format: 'wav' }) });
    const bytes = await bounded(response, 20 * 1024 * 1024);
    return this.wav(bytes);
  }
  async transcribe(config: VoiceConfig['asr'], audio: ArrayBuffer, key: string, signal: AbortSignal): Promise<string> {
    validateRecording(audio); const service = config[config.source]; const url = voiceEndpoint(service.url, config.source);
    const cpp = config.source === 'local' && config.localProtocol === 'whisper-cpp';
    if (!cpp && !service.model) throw new Error('请填写语音识别模型名称');
    const form = new FormData(); form.set('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav'); form.set('response_format', 'json');
    if (!cpp) form.set('model', service.model); if (config.language || cpp) form.set('language', config.language || 'auto');
    const response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal, headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form });
    const bytes = await bounded(response, 128 * 1024); let data: { text?: unknown };
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('识别服务未返回 JSON 结果'); }
    if (!data || typeof data.text !== 'string') throw new Error('识别服务没有返回 text 字段');
    const text = data.text.trim(); if (!text) throw new Error('没有识别到文字，请靠近麦克风后重试');
    if (text.length > 4000) throw new Error('识别结果超过 4000 字，请分段录音'); return text;
  }
}
