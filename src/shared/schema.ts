import { z } from 'zod';
export const AVATAR = 'deepblue-chibi-v1';
const finite = z.number().finite();
const duration = finite.min(1).max(30000);
export const localId = z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/);
export const globalId = z.string().regex(/^[a-zA-Z0-9_.-]{1,80}:[a-zA-Z0-9_.-]{1,80}$/);
export const channelSchema = z.enum(['pose', 'face', 'movement', 'effect', 'bubble']);
export type ActionChannel = z.infer<typeof channelSchema>;
export const easingSchema = z.enum(['linear', 'easeInOut', 'easeOut']);
export type Easing = z.infer<typeof easingSchema>;
export const nodes = ['root', 'body', 'head', 'hairBack', 'hairFront', 'armLeft', 'armRight', 'eyes', 'mouth', 'effects', 'tail'] as const;
export const expressions = ['neutral', 'smile', 'shy', 'annoyed', 'sleep', 'surprised'] as const;
export const effects = ['sparkles', 'hearts', 'sleepy', 'splash'] as const;
export const relativePath = z.string().min(1).max(240).refine(p => !p.includes('\\') && !p.includes('%') && !p.includes(':') && !p.startsWith('/') && p.split('/').every(s => s !== '..' && s !== '.' && s.length > 0), '路径必须位于动作包内，不能包含编码或父目录');
const keyframe = z.object({ timeMs: finite.min(0).max(30000), value: finite.min(-2000).max(2000), easing: easingSchema }).strict();
const track = z.object({ targetId: z.enum(nodes), property: z.enum(['offsetX', 'offsetY', 'rotationDeg', 'scaleX', 'scaleY', 'alpha']), keyframes: z.array(keyframe).min(2).max(120) }).strict();
const commonMotion = { schemaVersion: z.literal(1), id: localId, name: z.string().min(1).max(100), avatarId: z.literal(AVATAR), durationMs: duration, channels: z.array(channelSchema).min(1).max(5) };
const point = z.object({ x: finite.min(-4096).max(4096), y: finite.min(-4096).max(4096) }).strict();
const frameOptions = {
  displayScale: finite.min(.1).max(3).optional(),
  layers: z.array(z.object({ image: relativePath, x: finite.min(-4096).max(4096), y: finite.min(-4096).max(4096), pivotX: finite.min(-4096).max(4096), pivotY: finite.min(-4096).max(4096), rotationDeg: finite.min(-180).max(180), periodMs: finite.min(100).max(30000) }).strict()).max(8).optional(),
  hitAreas: z.array(z.object({ target: z.enum(['head','body']), x: finite.min(0).max(4096), y: finite.min(0).max(4096), width: finite.min(1).max(4096), height: finite.min(1).max(4096) }).strict()).max(8).optional()
};
export const motionSchema = z.discriminatedUnion('kind', [
  z.object({ ...commonMotion, kind: z.literal('rig_timeline'), tracks: z.array(track).min(1).max(60) }).strict(),
  z.object({ ...commonMotion, ...frameOptions, kind: z.literal('frame_animation'), frames: z.array(relativePath).min(1).max(240), fps: finite.min(1).max(60).optional(), frameDurationsMs: z.array(duration).max(240).optional(), canvas: z.object({ width: finite.int().min(1).max(4096), height: finite.int().min(1).max(4096) }).strict(), anchor: z.object({ x: finite.min(0).max(1), y: finite.min(0).max(1) }).strict() }).strict()
]);
export type Motion = z.infer<typeof motionSchema>;
export type ActionNode = { type: 'sequence'; children: ActionNode[] } | { type: 'parallel'; children: ActionNode[] } | { type: 'motion'; motionId: string; repeat: number } | { type: 'expression'; expressionId: string; durationMs: number } | { type: 'move_by'; dxDip: number; dyDip: number; durationMs: number; easing: Easing } | { type: 'effect'; effectId: string; durationMs: number; origin?: {x:number;y:number} } | { type: 'bubble'; text: string; durationMs: number } | { type: 'wait'; durationMs: number };
export const nodeSchema: z.ZodType<ActionNode> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.literal('sequence'), children: z.array(nodeSchema).min(1).max(128) }).strict(),
  z.object({ type: z.literal('parallel'), children: z.array(nodeSchema).min(1).max(128) }).strict(),
  z.object({ type: z.literal('motion'), motionId: globalId, repeat: finite.int().min(1).max(20) }).strict(),
  z.object({ type: z.literal('expression'), expressionId: z.enum(expressions), durationMs: duration }).strict(),
  z.object({ type: z.literal('move_by'), dxDip: finite.min(-1000).max(1000), dyDip: finite.min(-1000).max(1000), durationMs: duration, easing: easingSchema }).strict(),
  z.object({ type: z.literal('effect'), effectId: z.enum(effects), durationMs: duration, origin: point.optional() }).strict(),
  z.object({ type: z.literal('bubble'), text: z.string().min(1).max(120), durationMs: duration }).strict(),
  z.object({ type: z.literal('wait'), durationMs: duration }).strict()
]));
export const groupSchema = z.object({ schemaVersion: z.literal(1), id: localId, name: z.string().min(1).max(100), description: z.string().max(1000), tags: z.array(z.string().max(40)).max(20), enabled: z.boolean(), random: z.object({ eligible: z.boolean(), weight: finite.min(0).max(1000), cooldownMs: finite.min(0).max(86400000) }).strict(), conditions: z.object({ minIdleMs: finite.min(0).max(86400000), requiresRoaming: z.boolean(), requiresPointerAway: z.boolean(), requiresStanding: z.boolean().optional() }).strict(), maxDurationMs: duration, timeline: nodeSchema }).strict();
export type Group = z.infer<typeof groupSchema>;
export const packSchema = z.object({ schemaVersion: z.literal(1), id: localId, name: z.string().min(1).max(100), version: z.string().max(40), avatarId: z.literal(AVATAR), description: z.string().max(1000), motions: z.array(relativePath).max(500), groups: z.array(relativePath).min(1).max(500) }).strict();
export type Pack = z.infer<typeof packSchema>;
export interface LoadedPack { manifest: Pack; motions: Motion[]; groups: Group[]; assets: Record<string, string> }
export interface Registry { revision: number; packs: LoadedPack[] }
export interface GroupInfo extends Group { groupId: string; packId: string; packName: string; channels: ActionChannel[]; expectedDurationMs: number }
export interface Catalog { groups: Map<string, GroupInfo>; motions: Map<string, Motion>; assets: Map<string, string> }
export const overrideSchema = z.object({ enabled: z.boolean().optional(), eligible: z.boolean().optional(), weight: finite.min(0).max(1000).optional(), cooldownMs: finite.min(0).max(86400000).optional() }).strict();
export const settingsSchema = z.object({ schemaVersion: z.literal(1), size: finite.min(0.6).max(1.5), alwaysOnTop: z.boolean(), fixedPosition: z.boolean(), roaming: z.boolean(), intervalMinMs: finite.int().min(1000).max(60000), intervalMaxMs: finite.int().min(1000).max(120000), bubbles: z.boolean(), autonomousBubbles: z.boolean(), clickThrough: z.boolean(), fps: z.union([z.literal(30), z.literal(60)]), paused: z.boolean(), position: z.object({ x: finite, y: finite }).nullable(), headAction: globalId, bodyAction: globalId, overrides: z.record(globalId, overrideSchema) }).strict().refine(v => v.intervalMinMs <= v.intervalMaxMs, '随机最短间隔不能大于最长间隔');
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = { schemaVersion: 1, size: 1, alwaysOnTop: true, fixedPosition: false, roaming: true, intervalMinMs: 3000, intervalMaxMs: 10000, bubbles: true, autonomousBubbles: false, clickThrough: false, fps: 60, paused: false, position: null, headAction: 'builtin.deepblue:head_touch', bodyAction: 'builtin.deepblue:body_touch', overrides: {} };
export function guardTree(raw: unknown, depth = 0, counter = { n: 0 }): void {
  if (depth > 8 || ++counter.n > 128) throw new Error('动作树超过深度 8 或节点数 128');
  if (raw && typeof raw === 'object' && 'children' in raw && Array.isArray(raw.children)) for (const child of raw.children) guardTree(child, depth + 1, counter);
}
export function validateMotion(m: Motion): void {
  if (new Set(m.channels).size !== m.channels.length) throw new Error(`${m.id}: 通道重复`);
  if (m.kind === 'rig_timeline') {
    const keys = new Set<string>(); const required = new Set<ActionChannel>();
    for (const t of m.tracks) {
      const key = `${t.targetId}.${t.property}`; if (keys.has(key)) throw new Error(`${m.id}: 重复轨道`); keys.add(key);
      required.add(t.targetId === 'eyes' || t.targetId === 'mouth' ? 'face' : t.targetId === 'effects' ? 'effect' : 'pose');
      if (t.keyframes[0].timeMs !== 0 || t.keyframes.at(-1)!.timeMs !== m.durationMs) throw new Error(`${m.id}: 关键帧必须包含 0 与结束时间`);
      t.keyframes.forEach((k, i) => { if (i && k.timeMs <= t.keyframes[i - 1].timeMs) throw new Error(`${m.id}: 关键帧时间必须递增`); if (t.property === 'alpha' && (k.value < 0 || k.value > 1)) throw new Error('alpha 必须在 0～1'); if ((t.property === 'scaleX' || t.property === 'scaleY') && (Math.abs(k.value) < 0.1 || Math.abs(k.value) > 3)) throw new Error('缩放绝对值必须在 0.1～3'); });
    }
    if (m.channels.length !== required.size || m.channels.some(c => !required.has(c))) throw new Error(`${m.id}: motion 通道与轨道不一致`);
  } else {
    if (Boolean(m.fps) === Boolean(m.frameDurationsMs)) throw new Error(`${m.id}: fps 和单帧时长必须且只能选择一项`);
    if (m.frameDurationsMs && m.frameDurationsMs.length !== m.frames.length) throw new Error('单帧时长数量不匹配');
    const total = m.fps ? m.frames.length * 1000 / m.fps : m.frameDurationsMs!.reduce((a, b) => a + b, 0);
    if (Math.abs(total - m.durationMs) > 1) throw new Error('序列帧总时长不匹配');
    if (m.channels.length !== 2 || !m.channels.includes('pose') || !m.channels.includes('face')) throw new Error('全身序列帧必须占用 pose 和 face');
  }
}
export function analyze(node: ActionNode, motions: Map<string, Motion>): { channels: ActionChannel[]; duration: number } {
  if (node.type === 'sequence' || node.type === 'parallel') {
    const parts = node.children.map(c => analyze(c, motions)); const used = new Set<ActionChannel>();
    for (const p of parts) for (const c of p.channels) { if (node.type === 'parallel' && used.has(c)) throw new Error(`并行动作通道冲突：${c}`); used.add(c); }
    return { channels: [...used], duration: node.type === 'sequence' ? parts.reduce((a, b) => a + b.duration, 0) : Math.max(...parts.map(p => p.duration)) };
  }
  if (node.type === 'motion') { const m = motions.get(node.motionId); if (!m) throw new Error(`未知 motion：${node.motionId}`); return { channels: m.channels, duration: m.durationMs * node.repeat }; }
  return { channels: node.type === 'wait' ? [] : [node.type === 'expression' ? 'face' : node.type === 'move_by' ? 'movement' : node.type], duration: node.durationMs };
}
export function makeCatalog(registry: Registry): Catalog {
  const groups = new Map<string, GroupInfo>(); const motions = new Map<string, Motion>(); const assets = new Map<string, string>(); const packs = new Set<string>();
  for (const p of registry.packs) {
    packSchema.parse(p.manifest); if (packs.has(p.manifest.id)) throw new Error('重复动作包 ID'); packs.add(p.manifest.id);
    for (const raw of p.motions) { const m = motionSchema.parse(raw); validateMotion(m); const id = `${p.manifest.id}:${m.id}`; if (motions.has(id)) throw new Error(`重复 motion：${id}`); motions.set(id, m); }
    for (const [file, url] of Object.entries(p.assets)) assets.set(`${p.manifest.id}:${file}`, url);
  }
  for (const p of registry.packs) {
    for (const m of p.motions) if (m.kind === 'frame_animation') for (const frame of [...m.frames,...(m.layers??[]).map(l=>l.image)]) if (!assets.has(`${p.manifest.id}:${frame}`)) throw new Error(`缺少图片：${frame}`);
    for (const raw of p.groups) {
      guardTree(raw.timeline); const g = groupSchema.parse(raw); const a = analyze(g.timeline, motions); const id = `${p.manifest.id}:${g.id}`;
      if (groups.has(id)) throw new Error(`重复动作组：${id}`);
      if (g.maxDurationMs < a.duration + 100) throw new Error(`${g.name}: 看门狗需比预计时长多至少 100ms`);
      groups.set(id, { ...g, groupId: id, packId: p.manifest.id, packName: p.manifest.name, channels: a.channels, expectedDurationMs: a.duration });
    }
  }
  return { groups, motions, assets };
}
export function effective(g: GroupInfo, s: Settings): GroupInfo { const o = s.overrides[g.groupId]; return { ...g, enabled: o?.enabled ?? g.enabled, random: { eligible: o?.eligible ?? g.random.eligible, weight: o?.weight ?? g.random.weight, cooldownMs: o?.cooldownMs ?? g.random.cooldownMs } }; }

