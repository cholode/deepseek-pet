import { z } from 'zod';

// 软件插件独立于动作包：这里只定义协议与数据，不枚举任何具体软件或操作。
const pluginId = z.string().regex(/^[a-z][a-z0-9.-]{1,78}[a-z0-9]$/).refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value), '插件 ID 不能使用系统保留名称');
const localPath = z.string().trim().max(2000);
const relativePath = z.string().min(1).max(500).refine(value => !/[:\\]/.test(value) && ![...value].some(c => c.charCodeAt(0) < 32) && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part)), '必须使用插件内相对路径');
const toolName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const configurationField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'time', 'weekdays', 'select']),
  options: z.array(z.string().max(80)).max(20).optional(), min: z.number().optional(), max: z.number().optional()
}).strict();
export const softwarePluginSchema = z.object({
  schemaVersion: z.literal(1), id: pluginId, name: z.string().trim().min(1).max(80), version: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(2000), author: z.string().trim().max(120).default(''),
  configuration: z.object({ title: z.string().max(80), readTool: toolName, writeTool: toolName, fields: z.array(configurationField).max(20) }).strict().optional(),
  reminderTool: toolName.optional(),
  transport: z.discriminatedUnion('type', [
    z.object({ type: z.literal('stdio'), runtime: z.enum(['executable', 'node', 'python']), entry: relativePath, args: z.array(z.string().max(2000)).max(30).default([]) }).strict(),
    z.object({ type: z.literal('streamable-http'), defaultUrl: z.string().max(500).default('') }).strict()
  ])
}).strict();
export type SoftwarePlugin = z.infer<typeof softwarePluginSchema>;
export interface InstalledSoftwarePlugin { manifest: SoftwarePlugin; fingerprint: string }
export const softwareToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), description: z.string().max(1200),
  inputSchema: z.record(z.string(), z.unknown()), signature: z.string().length(64)
}).strict();
export type SoftwareTool = z.infer<typeof softwareToolSchema>;
export const softwareDraftSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), directory: localPath.min(1),
  pluginId, runtimePath: localPath.default(''), url: z.string().trim().max(500).default('')
}).strict();
export type SoftwareDraft = z.infer<typeof softwareDraftSchema>;
export const softwareEntrySchema = softwareDraftSchema.extend({
  id: z.string().uuid(), enabled: z.boolean(), fingerprint: z.string().length(64),
  tools: z.array(softwareToolSchema).max(100),
  grants: z.array(z.object({ name: z.string(), signature: z.string().length(64) }).strict()).max(100),
  sealedToken: z.string().max(16000).default(''),
  remindersEnabled: z.boolean().default(false), lastReminderKey: z.string().max(200).default('')
}).strict();
export type SoftwareEntry = z.infer<typeof softwareEntrySchema>;
export const softwareStoreSchema = z.object({ version: z.literal(1), entries: z.array(softwareEntrySchema).max(30) }).strict();
export interface SoftwareEntryView extends Omit<SoftwareEntry, 'sealedToken'> {
  hasToken: boolean; status: 'disconnected' | 'connecting' | 'connected' | 'error'; error?: string;
}
export interface SoftwareActivity { id: string; at: number; software: string; tool: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; message?: string }
export interface SoftwareView { plugins: InstalledSoftwarePlugin[]; bundled?: { id: string; name: string }[]; entries: SoftwareEntryView[]; busy: boolean; notice?: string; activities: SoftwareActivity[] }
export const softwareRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('choose-directory'), current: localPath }).strict(),
  z.object({ type: z.literal('choose-runtime'), current: localPath }).strict(),
  z.object({ type: z.literal('import-plugin') }).strict(),
  z.object({ type: z.literal('install-bundled'), id: pluginId }).strict(),
  z.object({ type: z.literal('configure-plugin'), id: z.string().uuid(), operation: z.enum(['read', 'write']), settings: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal('reminders'), id: z.string().uuid(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('remove-plugin'), id: pluginId }).strict(),
  z.object({ type: z.literal('save'), software: softwareDraftSchema, token: z.string().max(4000).optional() }).strict(),
  z.object({ type: z.literal('connect'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('disable'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('remove'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('grant'), id: z.string().uuid(), tools: z.array(z.string().max(64)).max(100) }).strict(),
  z.object({ type: z.literal('stop') }).strict()
]);
export type SoftwareRequest = z.infer<typeof softwareRequestSchema>;
export interface SoftwareResponse { ok: boolean; message?: string; selectedPath?: string; result?: unknown; state: SoftwareView }
export interface SoftwareBridge { software(request: SoftwareRequest): Promise<SoftwareResponse>; onSoftware(fn: (state: SoftwareView) => void): () => void }
