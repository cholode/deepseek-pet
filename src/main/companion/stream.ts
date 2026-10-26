import { z } from 'zod';
import type { ToolCall } from '../../companion/ports';

const chunkSchema = z.object({ choices: z.array(z.object({ index: z.number().optional(), finish_reason: z.string().nullable().optional(), delta: z.object({
  content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ index: z.number().int().min(0).max(3), id: z.string().optional(), type: z.literal('function').optional(), function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional() })).optional()
}).optional() })).optional() });

// SSE 按事件而不是网络包解析；UTF-8 解码器保留跨包的中文半字符。
export async function readCompletionStream(response: Response, signal: AbortSignal, onText: (delta: string) => void) {
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}，请检查地址、模型和密钥`);
  if (!response.body) throw new Error('服务返回空内容');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  const calls = new Map<number, ToolCall>(); let buffer = ''; let text = ''; let bytes = 0; let done = false; let finished = false;
  const consume = (event: string) => {
    const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!payload) return;
    if (payload === '[DONE]') { done = true; return; }
    const raw = JSON.parse(payload);
    if (raw.error) throw new Error('模型服务返回流式错误');
    const chunk = chunkSchema.parse(raw);
    const choice = chunk.choices?.find(c => c.index === undefined || c.index === 0);
    if (!choice) return;
    if (choice.finish_reason) finished = true;
    const delta = choice.delta;
    // 不转发 reasoning_content 或工具参数，气泡只显示面向用户的正文。
    if (delta?.content) { text += delta.content; onText(delta.content); }
    for (const part of delta?.tool_calls ?? []) {
      const call = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      if (call.function.arguments.length > 20000 || call.function.name.length > 200) throw new Error('流式工具参数过大');
      calls.set(part.index, call);
    }
  };
  try {
    while (!done) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer.replace(/\r\n/g, '\n')); break; }
      bytes += next.value.byteLength; if (bytes > 1000000) throw new Error('服务响应超过大小限制');
      buffer += decoder.decode(next.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); consume(event); if (done) break; }
    }
    signal.throwIfAborted();
    if (!done && !finished) throw new Error('流式回复意外中断，请重试');
    const result = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (result.some(call => !call.id || !call.function.name)) throw new Error('模型返回的工具调用不完整');
    return { text, calls: result };
  } finally { await reader.cancel().catch(() => {}); }
}
