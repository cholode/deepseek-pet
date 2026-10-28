import { z } from 'zod';
import type { ModelPort, ChatMessage, ToolDefinition } from '../../companion/ports';
import type { CompanionConfig } from '../../shared/companion';
import { endpoint, readJson } from './http';
import { readCompletionStream } from './stream';

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string().max(20000) }) })).max(4).optional() }) })).min(1) });
// 通用 Chat Completions 适配器：DeepSeek、本地 Ollama 等服务都通过同一个端口接入。
export class CompatibleModel implements ModelPort {
  constructor(private key: () => string, private request: typeof fetch = fetch) {}
  async complete(messages: ChatMessage[], config: CompanionConfig['model'], signal: AbortSignal, tools: ToolDefinition[] = [], onText?: (delta: string) => void) {
    const root = endpoint(config.baseUrl).toString().replace(/\/$/, '');
    // DeepSeek 官方接口默认开启思考，必须显式关闭；不向其他兼容服务强塞专用参数。
    const thinking = new URL(root).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {};
    const response = await this.request(`${root}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      headers: { 'Content-Type': 'application/json', ...(this.key() ? { Authorization: `Bearer ${this.key()}` } : {}) },
      body: JSON.stringify({ model: config.model, messages, stream: Boolean(onText), temperature: config.temperature, max_tokens: 1500,
        ...thinking,
        ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), tool_choice: 'auto' } : {}) })
    });
    if (onText && response.headers.get('content-type')?.includes('text/event-stream')) return readCompletionStream(response, signal, onText);
    // 某些兼容后端仍返回普通 JSON，保持可用，但不伪造逐字动画。
    const result = responseSchema.parse(await readJson(response));
    return { text: result.choices[0].message.content ?? '', calls: result.choices[0].message.tool_calls ?? [] };
  }
}
