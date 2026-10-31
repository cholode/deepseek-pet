import { z } from 'zod';
import { conversationPolicyDefaults, conversationPolicySchema } from './conversation-session';
import { speechEmotionSchema, speechLanguageSchema, type SpeechEmotion, type SpeechLanguage, type SpeechSegment } from './speech-language';

export const voicevoxDefaults = { url: 'http://127.0.0.1:50021', directory: '', autoStart: false, device: 'cpu' as const, cpuThreads: 0 };
const voicevoxSchema = z.object({ url: z.string().trim().max(1000), directory: z.string().max(2000), autoStart: z.boolean(), device: z.enum(['cpu', 'gpu']).default('cpu'), cpuThreads: z.number().int().min(0).max(64).default(0) }).strict();
export const whisperDefaults = { directory: '', modelPath: '', autoStart: false, cpuThreads: 8 };
const whisperSchema = z.object({ directory: z.string().max(2000), modelPath: z.string().max(2000), autoStart: z.boolean(), cpuThreads: z.number().int().min(1).max(64) }).strict();
export const gptSovitsDefaults = { url: 'http://127.0.0.1:9881', directory: '', autoStart: false, cpuThreads: 8, workers: 2, device: 'auto' as const, voice: 'neutral', japanese: false, autoEmotion: true };
const gptSovitsSchema = z.object({ url: z.string().trim().max(1000), directory: z.string().max(2000), autoStart: z.boolean(), cpuThreads: z.number().int().min(1).max(64), workers: z.number().int().min(1).max(4).default(2), device: z.enum(['auto', 'cpu', 'cuda']).default('auto'), voice: z.string().trim().min(1).max(100), japanese: z.boolean().default(false), autoEmotion: z.boolean().default(true) }).strict();

const service = z.object({ url: z.string().trim().max(1000), model: z.string().trim().max(120), voice: z.string().trim().max(200) }).strict();
export const voiceConfigSchema = z.object({
  session: conversationPolicySchema.default(conversationPolicyDefaults),
  tts: z.object({ enabled: z.boolean(), synthesisConcurrency: z.number().int().min(1).max(4).default(2), mode: z.enum(['single', 'language']).default('single'), languageChinese: z.enum(['system', 'configured']).default('system'), gptSovits: gptSovitsSchema.default(gptSovitsDefaults), voicevox: voicevoxSchema.default(voicevoxDefaults), source: z.enum(['local', 'cloud']), localEngine: z.enum(['system', 'http', 'gpt-sovits']), systemVoice: z.string().max(200), rate: z.number().min(0.5).max(2), volume: z.number().min(0).max(1), local: service, cloud: service }).strict(),
  asr: z.object({ enabled: z.boolean(), source: z.enum(['local', 'cloud']), localProtocol: z.enum(['compatible', 'whisper-cpp']), whisper: whisperSchema.default(whisperDefaults), language: z.string().regex(/^$|^[a-z]{2,3}$/), local: service.omit({ voice: true }), cloud: service.omit({ voice: true }) }).strict()
}).strict();
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
export const voiceDefaults: VoiceConfig = {
  session: { ...conversationPolicyDefaults },
  tts: { enabled: false, synthesisConcurrency: 2, mode: 'single', languageChinese: 'system', gptSovits: { ...gptSovitsDefaults }, voicevox: { ...voicevoxDefaults }, source: 'local', localEngine: 'system', systemVoice: '', rate: 1, volume: 0.8,
    local: { url: 'http://127.0.0.1:8880/v1/audio/speech', model: '', voice: '' }, cloud: { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', voice: 'coral' } },
  asr: { enabled: false, source: 'local', localProtocol: 'compatible', whisper: { ...whisperDefaults }, language: '',
    local: { url: 'http://127.0.0.1:8080/v1/audio/transcriptions', model: '' }, cloud: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-transcribe' } }
};
export const voiceSecretNames = ['ttsLocal', 'ttsCloud', 'asrLocal', 'asrCloud'] as const;
export type VoiceSecretName = typeof voiceSecretNames[number];
export const voiceSecretsSchema = z.object({ ttsLocal: z.string().max(4096).optional(), ttsCloud: z.string().max(4096).optional(), asrLocal: z.string().max(4096).optional(), asrCloud: z.string().max(4096).optional() }).strict();
export type VoiceSecrets = z.infer<typeof voiceSecretsSchema>;
export interface VoiceState { config: VoiceConfig; hasSecrets: Record<VoiceSecretName, boolean>; error?: string; preparing?: boolean }
export type VoiceEvent = { type: 'state'; state: VoiceState } | { type: 'stop-playback' | 'stop-all' };
export const maxRecordingSeconds = 60;
export const maxRecordingBytes = 16000 * 2 * maxRecordingSeconds + 44;
export const voiceRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('configure'), config: voiceConfigSchema, secrets: voiceSecretsSchema }).strict(),
  z.object({ type: z.literal('speak'), text: z.string().trim().min(1).max(24000), language: speechLanguageSchema.optional(), emotion: speechEmotionSchema.optional(), test: z.boolean().optional(), playbackId: z.string().uuid().optional(), chunk: z.number().int().min(0).max(24000).optional() }).strict(),
  z.object({ type: z.literal('voicevox-directory') }).strict(),
  z.object({ type: z.literal('voicevox-check') }).strict(),
  z.object({ type: z.literal('gpt-sovits-directory') }).strict(),
  z.object({ type: z.literal('gpt-sovits-check') }).strict(),
  z.object({ type: z.literal('asr-check') }).strict(),
  z.object({ type: z.literal('whisper-directory') }).strict(),
  z.object({ type: z.literal('whisper-model') }).strict(),
  z.object({ type: z.literal('capture-begin') }).strict(),
  z.object({ type: z.literal('transcribe'), captureId: z.string().uuid(), audio: z.instanceof(ArrayBuffer).refine(b => b.byteLength > 44 && b.byteLength <= maxRecordingBytes, '录音大小无效') }).strict(),
  z.object({ type: z.literal('cancel'), playbackOnly: z.boolean().optional(), playbackId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('report-error'), message: z.string().max(300) }).strict(),
  z.object({ type: z.literal('playback-progress'), presentationId: z.string().max(100), speechRevision: z.number().int().min(0).optional(), chunk: z.number().int().min(0).max(24000).optional(), finished: z.boolean().optional() }).strict()
]);
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;
export interface VoiceResponse { ok: boolean; message?: string; state?: VoiceState; directory?: string; modelPath?: string; captureId?: string; text?: string; audio?: ArrayBuffer; volume?: number; system?: VoiceConfig['tts'] }
export interface VoiceBridge { voice(request: VoiceRequest): Promise<VoiceResponse>; onVoice(fn: (event: VoiceEvent) => void): () => void }

// 旧版中日分声即使保留云端配置，也只使用微软中文。升级不能悄悄激活曾保存的云端接口。
export function configuredChinese(tts: VoiceConfig['tts']) { return tts.mode !== 'language' || tts.languageChinese === 'configured'; }
export function usesGptSovits(tts: VoiceConfig['tts']) { return configuredChinese(tts) && tts.source === 'local' && tts.localEngine === 'gpt-sovits'; }
export function usesVoicevox(tts: VoiceConfig['tts']) { return tts.mode === 'language' && !(usesGptSovits(tts) && tts.gptSovits.japanese); }

// 图片、链接地址和代码不适合朗读；长回复按句分段，避免服务的单次字数限制。
export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/<[^>]*>/g, '').replace(/^\s{0,3}(?:#{1,6}|>|[-*+]\s)\s*/gm, '').replace(/[*_`~|]/g, '').trim();
}
export function speechChunks(text: string, size = 180): string[] {
  return splitSpeech(speechText(text), size);
}
function splitSpeech(text: string, size = 180): string[] {
  const chars = Array.from(text); const result: string[] = [];
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

export interface SpeechChunk { text: string; language?: SpeechLanguage; emotion?: SpeechEmotion; displayEnd: number }
/** 情绪参考也会影响音色。普通续句沿用本轮的表达，不能每遇到 neutral 就换一段参考录音。 */
export function speechPlaybackPlan(text: string, tts: VoiceConfig['tts'] | undefined, segments?: SpeechSegment[], language?: SpeechLanguage): SpeechChunk[] {
  const chunks = speechPlan(text, segments, language);
  if (!tts || !usesGptSovits(tts) || !tts.gptSovits.autoEmotion) return chunks;
  let previous: SpeechEmotion | undefined;
  return chunks.map(chunk => {
    if (usesVoicevox(tts) && chunk.language === 'ja') return chunk;
    // 首句尊重模型；后续中性/漏标只表示没有新情绪。明确的难过、惊讶等仍可转折。
    // 状态只属于这一次播放，不修改模型原始标签，也不把上一轮心情带入下一轮。
    const emotion = previous && (!chunk.emotion || chunk.emotion === 'neutral') ? previous
      : chunk.emotion ?? speechEmotionSchema.safeParse(tts.gptSovits.voice).data;
    previous = emotion;
    return { ...chunk, emotion };
  });
}
/** 保留清理 Markdown 前的字符位置：音频只读正文，界面仍显示原来的格式、代码和图片。 */
export function speechPlan(text: string, segments?: SpeechSegment[], language?: SpeechLanguage): SpeechChunk[] {
  const result: SpeechChunk[] = []; let base = 0;
  for (const part of segments ?? [{ text, language, emotion: undefined }]) {
    let clean = part.text; let positions = Array.from({ length: clean.length }, (_, index) => base + index + 1);
    const strip = (pattern: RegExp, label = false) => {
      let next = ''; const offsets: number[] = []; let start = 0;
      for (const match of clean.matchAll(pattern)) {
        next += clean.slice(start, match.index); offsets.push(...positions.slice(start, match.index));
        if (label) { next += match[1]; offsets.push(...positions.slice(match.index! + 1, match.index! + 1 + match[1].length)); }
        start = match.index! + match[0].length;
      }
      next += clean.slice(start); offsets.push(...positions.slice(start)); clean = next; positions = offsets;
    };
    strip(/```[\s\S]*?```/g); strip(/!\[[^\]]*\]\([^)]+\)/g); strip(/\[([^\]]+)\]\([^)]+\)/g, true);
    strip(/https?:\/\/\S+/g); strip(/<[^>]*>/g); strip(/^\s{0,3}(?:#{1,6}|>|[-*+]\s)\s*/gm); strip(/[*_`~|]/g);
    const leading = clean.length - clean.trimStart().length; positions = positions.slice(leading, clean.trimEnd().length); clean = clean.trim();
    let used = 0;
    for (const chunk of splitSpeech(clean)) {
      // splitSpeech 会跳过独立空白行，但位置仍须跨过这些原始字符。
      used = clean.indexOf(chunk, used) + chunk.length;
      let displayEnd = positions[used - 1];
      // 句尾 Markdown/引号也一并显示，避免粗体等格式在下一句之前留下半个标记。
      while (displayEnd < base + part.text.length && /[*_`~」』”’"）)]/.test(part.text[displayEnd - base])) displayEnd++;
      result.push({ text: chunk, language: part.language, emotion: part.emotion, displayEnd });
    }
    base += part.text.length;
  }
  if (result.length) result[result.length - 1].displayEnd = base;
  return result;
}
