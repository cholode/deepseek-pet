import { z } from 'zod';
import type { Emotion } from './companion';

// 悬停窗口只接收聊天所需信息，不暴露密钥、记忆管理或 MCP 配置权限。
export type QuickChatTab = 'chat' | 'status';
export interface QuickPetStatus {
  mode: 'normal' | 'ai'; action: string; behavior: string; speechEnabled: boolean;
  mood: { value: number; emotion: Emotion } | null;
}
export interface QuickChatState { name: string; ready: boolean; busy: boolean; reply: string; streaming: boolean; tab: QuickChatTab; status: QuickPetStatus | null; error?: string }
export interface SpeechTail { side: 'bottom' | 'left' | 'right'; offset: number }
export interface SpeechBubbleState { id: string; text: string; streaming: boolean; tail?: SpeechTail }
export const quickChatRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('tab'), tab: z.enum(['chat', 'status']) }).strict(),
  z.object({ type: z.literal('send'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
  z.object({ type: z.literal('dismiss') }).strict(),
  z.object({ type: z.literal('settings') }).strict(),
  z.object({ type: z.literal('hold'), value: z.boolean() }).strict()
]);
export type QuickChatRequest = z.infer<typeof quickChatRequestSchema>;
export interface QuickChatResponse { ok: boolean; state: QuickChatState; message?: string }
export interface PetChatBridge {
  openChatLink(url: string): Promise<void>;
  dismissSpeechBubble(): Promise<void>;
  quickChat(request: QuickChatRequest): Promise<QuickChatResponse>;
  onQuickChat(fn: (state: QuickChatState) => void): () => void;
  speechBubbleState(): Promise<SpeechBubbleState | null>;
  onSpeechBubble(fn: (state: SpeechBubbleState | null) => void): () => void;
  sizeSpeechBubble(size: { width: number; height: number }): Promise<void>;
}
