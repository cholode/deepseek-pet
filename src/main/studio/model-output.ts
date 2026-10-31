import { z } from 'zod';

// 模型输出是文本，不是 IPC。允许说明文字、代码围栏和额外字段；落盘前仍转换成统一数据格式。
// 不使用 eval，也不凭空补题目、参考答案或评分。缺少这些内容时才请求一次格式修复。
export class ModelOutputError extends Error {}
type Shape = { type?: string; properties?: Record<string, Shape>; items?: Shape; anyOf?: Shape[] };
function normalize(value: unknown, shape: Shape): unknown {
  if (shape.anyOf) {
    const candidate = shape.anyOf.find(s => s.type === (Array.isArray(value) ? 'array' : typeof value));
    if (candidate) return normalize(value, candidate);
  }
  if (shape.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(shape.properties ?? {}).filter(([key]) => source[key] !== undefined).map(([key, field]) => [key, normalize(source[key], field)]));
  }
  if (shape.type === 'array' && Array.isArray(value)) return value.map(item => normalize(item, shape.items ?? {}));
  if ((shape.type === 'integer' || shape.type === 'number') && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (shape.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}
export function parseModelOutput<T>(raw: string, schema: z.ZodType<T>, prepare?: (value: unknown) => unknown): T {
  const candidates: string[] = [raw.trim()];
  // 从带有前言/后记的回答中提取完整 JSON；字符串里的括号和转义引号不能被当成边界。
  const start = raw.search(/[[{]/);
  if (start >= 0) {
    let depth = 0; let quoted = false; let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === '[' || c === '{') depth++;
      else if ((c === ']' || c === '}') && --depth === 0) { candidates.push(raw.slice(start, i + 1)); break; }
    }
  }
  let error = '';
  for (const candidate of candidates) {
    try { const value: unknown = JSON.parse(candidate); return schema.parse(normalize(prepare ? prepare(value) : value, z.toJSONSchema(schema) as Shape)); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  throw new ModelOutputError(`模型输出缺少可用内容或格式无法读取：${error.slice(0, 1200)}`);
}

export function normalizeLessonDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const lesson = raw as Record<string, unknown>;
  // ID 由宿主生成，模型的漏写/重复 ID 不应卡住一份可用课件，也不会影响已开始的课堂。
  if (Array.isArray(lesson.exercises)) lesson.exercises = lesson.exercises.map((exercise, i) => exercise && typeof exercise === 'object' ? { ...exercise, id: `q${i + 1}` } : exercise);
  return lesson;
}
