import { z } from 'zod';
import { conversationPolicyDefaults, conversationPolicySchema } from './conversation-session';
import { speechLanguageSchema } from './speech-language';

export const voicevoxDefaults = { url: 'http://127.0.0.1:50021', directory: '', autoStart: false, device: 'cpu' as const, cpuThreads: 0 };
const voicevoxSchema = z.object({ url: z.string().trim().max(1000), directory: z.string().max(2000), autoStart: z.boolean(), device: z.enum(['cpu', 'gpu']).default('cpu'), cpuThreads: z.number().int().min(0).max(64).default(0) }).strict();

const service = z.object({ url: z.string().trim().max(1000), model: z.string().trim().max(120), voice: z.string().trim().max(200) }).strict();
export const voiceConfigSchema = z.object({
  session: conversationPolicySchema.default(conversationPolicyDefaults),
  tts: z.object({ enabled: z.boolean(), mode: z.enum(['single', 'language']).default('single'), voicevox: voicevoxSchema.default(voicevoxDefaults), source: z.enum(['local', 'cloud']), localEngine: z.enum(['system', 'http']), systemVoice: z.string().max(200), rate: z.number().min(0.5).max(2), volume: z.number().min(0).max(1), local: service, cloud: service }).strict(),
  asr: z.object({ enabled: z.boolean(), source: z.enum(['local', 'cloud']), localProtocol: z.enum(['compatible', 'whisper-cpp']), language: z.string().regex(/^$|^[a-z]{2,3}$/), local: service.omit({ voice: true }), cloud: service.omit({ voice: true }) }).strict()
}).strict();
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
export const voiceDefaults: VoiceConfig = {
  session: { ...conversationPolicyDefaults },
  tts: { enabled: false, mode: 'single', voicevox: { ...voicevoxDefaults }, source: 'local', localEngine: 'system', systemVoice: '', rate: 1, volume: 0.8,
    local: { url: 'http://127.0.0.1:8880/v1/audio/speech', model: '', voice: '' }, cloud: { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', voice: 'coral' } },
  asr: { enabled: false, source: 'local', localProtocol: 'compatible', language: '',
    local: { url: 'http://127.0.0.1:8080/v1/audio/transcriptions', model: '' }, cloud: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-transcribe' } }
};
export const voiceSecretNames = ['ttsLocal', 'ttsCloud', 'asrLocal', 'asrCloud'] as const;
export type VoiceSecretName = typeof voiceSecretNames[number];
export const voiceSecretsSchema = z.object({ ttsLocal: z.string().max(4096).optional(), ttsCloud: z.string().max(4096).optional(), asrLocal: z.string().max(4096).optional(), asrCloud: z.string().max(4096).optional() }).strict();
export type VoiceSecrets = z.infer<typeof voiceSecretsSchema>;
export interface VoiceState { config: VoiceConfig; hasSecrets: Record<VoiceSecretName, boolean>; error?: string }
export type VoiceEvent = { type: 'state'; state: VoiceState } | { type: 'stop-playback' | 'stop-all' };
export const maxRecordingSeconds = 60;
export const maxRecordingBytes = 16000 * 2 * maxRecordingSeconds + 44;
export const voiceRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('configure'), config: voiceConfigSchema, secrets: voiceSecretsSchema }).strict(),
  z.object({ type: z.literal('speak'), text: z.string().trim().min(1).max(24000), language: speechLanguageSchema.optional(), test: z.boolean().optional(), playbackId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('voicevox-directory') }).strict(),
  z.object({ type: z.literal('voicevox-check') }).strict(),
  z.object({ type: z.literal('capture-begin') }).strict(),
  z.object({ type: z.literal('transcribe'), captureId: z.string().uuid(), audio: z.instanceof(ArrayBuffer).refine(b => b.byteLength > 44 && b.byteLength <= maxRecordingBytes, '录音大小无效') }).strict(),
  z.object({ type: z.literal('cancel'), playbackOnly: z.boolean().optional(), playbackId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('report-error'), message: z.string().max(300) }).strict()
]);
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;
export interface VoiceResponse { ok: boolean; message?: string; state?: VoiceState; directory?: string; captureId?: string; text?: string; audio?: ArrayBuffer; volume?: number; system?: VoiceConfig['tts'] }
export interface VoiceBridge { voice(request: VoiceRequest): Promise<VoiceResponse>; onVoice(fn: (event: VoiceEvent) => void): () => void }

// 图片、链接地址和代码不适合朗读；长回复按句分段，避免服务的单次字数限制。
export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/<[^>]*>/g, '').replace(/^\s{0,3}(?:#{1,6}|>|[-*+]\s)\s*/gm, '').replace(/[*_`~|]/g, '').trim();
}
export function speechChunks(text: string, size = 180): string[] {
  const chars = Array.from(speechText(text)); const result: string[] = [];
  // 一句就绪即可播放，不等长段落；英文小数点不作为句界，保留句尾引号。
  const limit = Math.max(1, Math.floor(size));
  while (chars.length) {
    let end = Math.min(limit, chars.length);
    for (let i = 0; i < end; i++) if (/[。！？!?\n]/.test(chars[i]) || (chars[i] === '.' && (!chars[i + 1] || /\s/.test(chars[i + 1])))) {
      end = i + 1; while (end < Math.min(limit, chars.length) && /[。！？!?」』”’"）)]/.test(chars[end])) end++; break;
    }
    const chunk = chars.splice(0, end).join(''); if (chunk.trim()) result.push(chunk);
  }
  return result;
}
