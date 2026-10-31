import { z } from 'zod';
import { speechSegmentSchema, type SpeechSegment } from './speech-language';
import { growthSchema, traitSchema } from './growth';

// 跨进程契约只包含数据；人格、记忆、模型和渠道均不依赖 Electron 或人物渲染器。
export const emotionNames = ['happy', 'calm', 'curious', 'confused', 'shy', 'frustrated', 'sleepy'] as const;
export const emotionLabels: Record<Emotion, string> = { happy: '开心', calm: '平静', curious: '好奇', confused: '困惑', shy: '害羞', frustrated: '受挫', sleepy: '困倦' };
export type Emotion = typeof emotionNames[number];
const shortText = z.string().trim().min(1).max(600);
export const companionConfigSchema = z.object({
  enabled: z.boolean(),
  persona: z.object({ name: z.string().trim().min(1).max(30), description: z.string().trim().min(1).max(3000), userName: z.string().trim().min(1).max(40) }).strict(),
  model: z.object({ baseUrl: z.string().url().max(500), model: z.string().trim().max(120), temperature: z.number().min(0).max(2), timeoutMs: z.number().int().min(5000).max(120000) }).strict(),
  memory: z.object({ automatic: z.boolean(), halfLifeDays: z.number().min(1).max(3650), recallLimit: z.number().int().min(1).max(15) }).strict(),
  mood: z.object({ enabled: z.boolean(), baseline: z.number().min(0).max(100), halfLifeHours: z.number().min(1).max(168) }).strict(),
  initiative: z.object({ enabled: z.boolean(), quietStart: z.number().int().min(0).max(23), quietEnd: z.number().int().min(0).max(23), idleMinutes: z.number().min(1).max(1440), cooldownMinutes: z.number().min(1).max(1440), dailyLimit: z.number().int().min(1).max(20) }).strict(),
  speech: z.object({ enabled: z.boolean(), voice: z.string().max(200), rate: z.number().min(0.5).max(2), volume: z.number().min(0).max(1) }).strict(),
  qq: z.object({ enabled: z.boolean(), baseUrl: z.string().url().max(500), kind: z.enum(['private', 'group']), targetId: z.string().regex(/^\d{0,20}$/), ownerId: z.string().regex(/^\d{0,20}$/) }).strict(),
  mcp: z.object({ enabled: z.boolean(), url: z.string().max(500), allowedTools: z.array(z.string().min(1).max(200)).max(50) }).strict()
}).strict();
export type CompanionConfig = z.infer<typeof companionConfigSchema>;
export const companionDefaults: CompanionConfig = {
  enabled: false,
  persona: { name: '大肥鱼', userName: '你', description: '你是大肥鱼，一只憨憨、好奇、偶尔嘴硬的蓝色鲸鱼桌宠。说话自然简短，记得真实的共同经历。关心用户但尊重独处；不编造经历，不声称做过尚未验证的操作。' },
  model: { baseUrl: 'http://127.0.0.1:11434/v1', model: '', temperature: 0.7, timeoutMs: 60000 },
  memory: { automatic: true, halfLifeDays: 30, recallLimit: 6 },
  mood: { enabled: true, baseline: 70, halfLifeHours: 12 },
  initiative: { enabled: false, quietStart: 23, quietEnd: 8, idleMinutes: 20, cooldownMinutes: 60, dailyLimit: 4 },
  speech: { enabled: false, voice: '', rate: 1, volume: 0.8 },
  qq: { enabled: false, baseUrl: 'http://127.0.0.1:3000', kind: 'private', targetId: '', ownerId: '' },
  mcp: { enabled: false, url: '', allowedTools: [] }
};
export const memorySchema = z.object({
  id: z.string(), text: shortText, kind: z.enum(['episode', 'fact', 'preference']), factKey: z.string().max(100), scope: z.enum(['private', 'public']),
  importance: z.number().min(0).max(1), pinned: z.boolean(), createdAt: z.number(), eventAt: z.number(), lastRecalledAt: z.number().optional(),
  sourceId: z.string(), evidence: z.string().max(2000), supersededBy: z.string().optional(), deletedAt: z.number().optional()
}).strict();
export type Memory = z.infer<typeof memorySchema>;
export const goalSchema = z.object({ id: z.string(), text: shortText, dueAt: z.number().finite(), completed: z.boolean(), lastAttemptAt: z.number().optional() }).strict();
export type Goal = z.infer<typeof goalSchema>;
export const moodSchema = z.object({ value: z.number(), updatedAt: z.number(), emotions: z.record(z.enum(emotionNames), z.number()), timeline: z.array(z.object({ eventId: z.string(), at: z.number(), reason: z.string(), delta: z.number(), emotion: z.enum(emotionNames) })).max(100) });
export type Mood = z.infer<typeof moodSchema>;
export const eventSchema = z.object({ id: z.string(), at: z.number(), source: z.enum(['desktop', 'qq-private', 'qq-group', 'initiative', 'interaction']), actor: z.enum(['user', 'pet', 'system']), conversationId: z.string(), sessionId: z.string().optional(), sessionEndedAt: z.number().finite().optional(), text: z.string().max(8000), speechSegments: z.array(speechSegmentSchema).max(2000).optional(), causeId: z.string().optional() }).strict();
export type CompanionEvent = z.infer<typeof eventSchema>;
export const companionDataSchema = z.object({
  version: z.literal(1), config: companionConfigSchema, growth: growthSchema.optional(), memories: z.array(memorySchema).max(10000), goals: z.array(goalSchema).max(200), mood: moodSchema,
  events: z.array(eventSchema).max(400), processedIds: z.array(z.string()).max(1000),
  initiative: z.object({ lastAt: z.number(), day: z.string(), count: z.number(), lastTopic: z.string() }), qqCursor: z.number()
});
export type CompanionData = z.infer<typeof companionDataSchema>;
export interface RecallHit { id: string; text: string; score: number; reason: string }
export interface CompanionView {
  data: CompanionData; busy: boolean; ready: boolean; error?: string; notice?: string; recalls: RecallHit[];
  hasSecrets: Record<'model' | 'qq' | 'mcp', boolean>; tools: { name: string; description: string }[];
}
export interface CompanionPresentation { id: string; text: string; speechSegments?: SpeechSegment[]; speechRevision?: number; emotion: Emotion; groupId?: string; speech: CompanionConfig['speech']; source: CompanionEvent['source']; phase?: 'streaming' | 'complete' | 'action' }
export const companionRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('growth-configure'), enabled: z.boolean(), locked: z.array(traitSchema).max(4) }).strict(),
  z.object({ type: z.literal('growth-rollback'), id: z.string().max(200) }).strict(),
  z.object({ type: z.literal('state'), forExport: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('configure'), config: companionConfigSchema, secrets: z.object({ model: z.string().max(4000).optional(), qq: z.string().max(4000).optional(), mcp: z.string().max(4000).optional() }).strict().optional() }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
  z.object({ type: z.literal('remember'), text: shortText, kind: z.enum(['episode', 'fact', 'preference']), factKey: z.string().max(100), scope: z.enum(['private', 'public']), pinned: z.boolean() }).strict(),
  z.object({ type: z.literal('forget'), id: z.string().max(100) }).strict(),
  z.object({ type: z.literal('recall'), query: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('goal'), text: shortText, dueAt: z.number().finite() }).strict(),
  z.object({ type: z.literal('complete-goal'), id: z.string().max(100) }).strict(),
  z.object({ type: z.literal('discover-tools') }).strict(),
  z.object({ type: z.literal('clear-history') }).strict(),
  z.object({ type: z.literal('reset-mood') }).strict()
]);
export type CompanionRequest = z.infer<typeof companionRequestSchema>;
export interface CompanionResponse { ok: boolean; message?: string; state: CompanionView }
export interface CompanionBridge {
  companion(request: CompanionRequest): Promise<CompanionResponse>;
  onCompanion(fn: (state: CompanionView) => void): () => void;
  onPresentation(fn: (presentation: CompanionPresentation | null) => void): () => void;
}
