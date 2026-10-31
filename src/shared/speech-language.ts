import { z } from 'zod';

export const speechLanguageSchema = z.enum(['zh', 'ja']);
export type SpeechLanguage = z.infer<typeof speechLanguageSchema>;
export const speechEmotionSchema = z.enum(['neutral', 'happy', 'sad', 'angry', 'surprised', 'afraid', 'disgusted']);
export type SpeechEmotion = z.infer<typeof speechEmotionSchema>;
export const speechSegmentSchema = z.object({ language: speechLanguageSchema, text: z.string().max(8000), emotion: speechEmotionSchema.optional() }).strict();
export type SpeechSegment = z.infer<typeof speechSegmentSchema>;
const voiceTags = () => /<voice\b[^>]*>|<\/voice\s*>/g;
/** 只提交闭合的语言片段。网络半标签、半句话留在文字流中，绝不提前交给 TTS。 */
export function completedSpeechSegments(raw: string): SpeechSegment[] {
  const last = [...raw.matchAll(/<\/voice\s*>/g)].at(-1);
  if (!last) return [];
  const prefix = raw.slice(0, last.index! + last[0].length).trimStart();
  if (!hasSpeechLanguages(prefix)) return [];
  let remaining = 8000;
  return parseSpeechLanguages(prefix).segments.flatMap(segment => {
    const text = segment.text.slice(0, remaining); remaining -= text.length;
    return text ? [{ ...segment, text }] : [];
  });
}
function attributes(tag: string) {
  const language = speechLanguageSchema.safeParse(/\blang=["']([^"']*)["']/.exec(tag)?.[1]);
  const rawEmotion = /\bemotion=["']([^"']*)["']/.exec(tag)?.[1];
  // 情绪漏标保持默认；不认识的情绪降为中立，不为一次元数据错误重做整句。
  return { language: language.success ? language.data : undefined, emotion: rawEmotion === undefined ? undefined : speechEmotionSchema.safeParse(rawEmotion).data ?? 'neutral' as const };
}

/** 严格校验输出协议；非空正文都必须被语言标签覆盖，拒绝嵌套和未闭合标签。 */
export function hasSpeechLanguages(raw: string): boolean {
  let active = false; let found = false; let offset = 0;
  for (const match of raw.matchAll(voiceTags())) {
    if (!active && raw.slice(offset, match.index).trim()) return false;
    if (!match[0].startsWith('</')) { if (active || !attributes(match[0]).language) return false; active = true; found = true; }
    else { if (!active) return false; active = false; }
    offset = match.index! + match[0].length;
  }
  return found && !active && !raw.slice(offset).trim();
}

// 模型在同一次回复中标注语言；不靠汉字/假名猜测，避免把「先生」等日语词读成中文。
export const speechLanguagePrompt = '本次回复用于按语言和情绪朗读。请在同一次正文生成中逐句标注，每句用 <voice lang="zh" emotion="neutral">中文</voice> 或 <voice lang="ja" emotion="happy">日本語</voice> 包裹。emotion 只能选 neutral（中立）、happy（开心）、sad（难过）、angry（生气）、surprised（吃惊）、afraid（恐惧）、disgusted（厌恶）；根据这句话的表达意图选择，普通解释用 neutral，不要为了变化而夸大情绪。中文解释与引用的日语单词必须分开，纯汉字日语词也标 ja，同一句内切换语言可沿用情绪。所有面向用户的正文都要标注；不要翻译或改写原本要说的话。Markdown 格式保留，代码块、链接和表情标记保持原样。标签是元数据，不向用户解释，工具参数和 JSON 不加标签。例：<voice lang="zh" emotion="happy">答对啦！</voice><voice lang="ja" emotion="neutral">先生</voice><voice lang="zh" emotion="neutral">，意思是老师。</voice>';

/** 处理完整回复及任意网络分片；未标注的旧回复按中文处理，保留可显示正文。 */
export function parseSpeechLanguages(raw: string, streaming = false): { text: string; segments: SpeechSegment[] } {
  const segments: SpeechSegment[] = []; let language: SpeechLanguage = 'zh'; let emotion: SpeechEmotion | undefined; let start = 0;
  // 只识别协议自身的标签，避免删除普通 Markdown/HTML 内容。
  const tags = voiceTags();
  const append = (text: string) => {
    if (!text) return;
    // 标签闭合就是一个稳定的提交边界；即使相邻两句语言/情绪相同也不合并。
    // 否则前句没有句号时，下一句到达会改写已进入合成队列的文本。
    segments.push({ language, text, ...(emotion ? { emotion } : {}) });
  };
  for (const match of raw.matchAll(tags)) {
    append(raw.slice(start, match.index)); const attr = attributes(match[0]); language = attr.language ?? 'zh'; emotion = attr.emotion; start = match.index! + match[0].length;
  }
  let tail = raw.slice(start);
  // 不把流式传输中尚未闭合的标签闪到聊天窗口，也不朗读被截断的标签。
  const index = tail.lastIndexOf('<');
  if (index >= 0) {
    const suffix = tail.slice(index);
    if (/^<\/?voice\b[^>]*$/.test(suffix) || (streaming && ['<voice', '</voice'].some(tag => tag.startsWith(suffix)))) tail = tail.slice(0, index);
  }
  append(tail);
  return { text: segments.map(segment => segment.text).join(''), segments };
}
