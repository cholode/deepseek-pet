import { z } from 'zod';

export const speechLanguageSchema = z.enum(['zh', 'ja']);
export type SpeechLanguage = z.infer<typeof speechLanguageSchema>;
export const speechSegmentSchema = z.object({ language: speechLanguageSchema, text: z.string().max(8000) }).strict();
export type SpeechSegment = z.infer<typeof speechSegmentSchema>;

/** 严格校验输出协议；非空正文都必须被语言标签覆盖，拒绝嵌套和未闭合标签。 */
export function hasSpeechLanguages(raw: string): boolean {
  let active = false; let found = false; let offset = 0;
  for (const match of raw.matchAll(/<voice\s+lang=["'](zh|ja)["']\s*>|<\/voice\s*>/g)) {
    if (!active && raw.slice(offset, match.index).trim()) return false;
    if (match[1]) { if (active) return false; active = true; found = true; }
    else { if (!active) return false; active = false; }
    offset = match.index! + match[0].length;
  }
  return found && !active && !raw.slice(offset).trim();
}

// 模型在同一次回复中标注语言；不靠汉字/假名猜测，避免把「先生」等日语词读成中文。
export const speechLanguagePrompt = '本次回复用于中日分声朗读。请在生成正文时按实际语言分段，每段用 <voice lang="zh">中文</voice> 或 <voice lang="ja">日本語</voice> 包裹。中文解释与其中引用的日语单词/句子必须分开标注，纯汉字日语词也必须标 ja。所有面向用户的正文都要标注；不要翻译或改写原本要说的话。Markdown 格式保留在段内或跨段，代码块、链接地址、表情标记保持原样。标签是供程序使用的元数据，不要向用户解释。工具调用的参数和 JSON 不加标签。例：<voice lang="zh">今天练习：</voice><voice lang="ja">先生</voice><voice lang="zh">，意思是老师。</voice>';

/** 处理完整回复及任意网络分片；未标注的旧回复按中文处理，保留可显示正文。 */
export function parseSpeechLanguages(raw: string, streaming = false): { text: string; segments: SpeechSegment[] } {
  const segments: SpeechSegment[] = []; let language: SpeechLanguage = 'zh'; let start = 0;
  // 只识别协议自身的标签，避免删除普通 Markdown/HTML 内容。
  const tags = /<voice\s+lang=["'](zh|ja)["']\s*>|<\/voice\s*>/g;
  const append = (text: string) => {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.language === language) last.text += text; else segments.push({ language, text });
  };
  for (const match of raw.matchAll(tags)) {
    append(raw.slice(start, match.index)); language = match[1] === 'ja' ? 'ja' : 'zh'; start = match.index! + match[0].length;
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
