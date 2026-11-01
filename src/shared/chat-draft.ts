import { z } from 'zod';

// renderer 只提交目录 ID；图片地址和资料由宿主重新解析，不能借附件读取任意文件。
export const chatDraftFields = { text: z.string().trim().max(4000), stickerId: z.string().min(1).max(200).optional() };
export const hasChatContent = (draft: { text: string; stickerId?: string }) => Boolean(draft.text || draft.stickerId);

export function insertEmoji(text: string, emoji: string, start: number, end: number) {
  const next = text.slice(0, start) + emoji + text.slice(end);
  return next.length <= 4000 ? { text: next, cursor: start + emoji.length } : undefined;
}
