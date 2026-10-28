import { describe, expect, it, vi } from 'vitest';
import { readCompletionStream } from '../src/main/companion/stream';
import { CompatibleModel } from '../src/main/companion/model';
import { companionDefaults } from '../src/shared/companion';
import { fixture, assessment } from './companion-fixture';

const event = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`;
const response = (text: string, size = 7) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
describe('真实流式回复', () => {
  it('跨网络包的中文与 CRLF 正确拼接，只展示正文', async () => {
    const onText = vi.fn();
    const result = await readCompletionStream(response(': heartbeat\r\n\r\n' + event({ reasoning_content: '内部分析' }) + event({ content: '你好，' }) + event({ content: '大肥鱼🐟' }, 'stop') + 'data: [DONE]\r\n\r\n', 1), new AbortController().signal, onText);
    expect(result).toEqual({ text: '你好，大肥鱼🐟', calls: [] });
    expect(onText.mock.calls.flat()).toEqual(['你好，', '大肥鱼🐟']);
  });
  it('工具参数按索引累积，不作为正文发送', async () => {
    const onText = vi.fn();
    const result = await readCompletionStream(response(event({ tool_calls: [{ index: 0, id: 'call1', type: 'function', function: { name: 'read', arguments: '{"x":' } }] }) + event({ tool_calls: [{ index: 0, function: { arguments: '2}' } }] }, 'tool_calls')), new AbortController().signal, onText);
    expect(result.calls).toEqual([{ id: 'call1', type: 'function', function: { name: 'read', arguments: '{"x":2}' } }]); expect(onText).not.toHaveBeenCalled();
  });
  it('一条响应超过四个工具仍完整解析，包括后续参数分片', async () => {
    const tools = Array.from({ length: 7 }, (_, index) => ({ index, id: `call-${index}`, type: 'function', function: { name: 'read', arguments: '{"x":' } }));
    const tails = tools.map(({ index }) => ({ index, function: { arguments: `${index}}` } }));
    const result = await readCompletionStream(response(event({ tool_calls: tools }) + event({ tool_calls: tails }, 'tool_calls')), new AbortController().signal, () => {});
    expect(result.calls.map(c => JSON.parse(c.function.arguments).x)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('意外断流、错误、缺失工具名称不被当作完成', async () => {
    for (const [body, message] of [[event({ content: '未完成' }), '意外中断'], ['data: {"error":"bad"}\n\n', '流式错误'], [event({ tool_calls: [{ index: 0, id: 'call1' }] }, 'tool_calls'), '不完整']]) {
      await expect(readCompletionStream(response(body), new AbortController().signal, () => {})).rejects.toThrow(message);
    }
  });
  it('取消后不再派发正在读取的迟到内容', async () => {
    const controller = new AbortController(); const callback = vi.fn();
    let enqueue!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(stream) { enqueue = () => { stream.enqueue(new TextEncoder().encode(event({ content: '迟到' }, 'stop'))); stream.close(); }; } });
    const pending = readCompletionStream(new Response(body), controller.signal, callback);
    controller.abort(); enqueue(); await expect(pending).rejects.toThrow(); expect(callback).not.toHaveBeenCalled();
  });
  it('适配器声明 stream，兼容后端普通 JSON 返回，不伪造逐字输出', async () => {
    let payload: Record<string, unknown> = {};
    const request: typeof fetch = vi.fn(async (_url, options) => { payload = JSON.parse(String(options?.body)); return Response.json({ choices: [{ message: { content: '完整回复' } }] }); });
    const callback = vi.fn(); const model = new CompatibleModel(() => '', request);
    expect(await model.complete([], companionDefaults.model, new AbortController().signal, [], callback)).toEqual({ text: '完整回复', calls: [] });
    expect(payload.stream).toBe(true); expect(callback).not.toHaveBeenCalled();
  });
  it('正文先显示，评价仅补动作；取消后忽略迟到分段', async () => {
    const f = fixture(); let finish!: () => void; let delta!: (value: string) => void;
    f.model.complete.mockImplementationOnce(async (_messages, _config, _signal, _tools, onText) => {
      delta = onText!; delta('正在回复'); await new Promise<void>(resolve => { finish = resolve; }); return { text: '正在回复，完成啦', calls: [] };
    }).mockResolvedValueOnce(assessment());
    const pending = f.coordinator.chat('你好'); await vi.waitFor(() => expect(f.host.present).toHaveBeenCalledWith(expect.objectContaining({ phase: 'streaming', text: '正在回复' })));
    expect(f.data.events.filter(e => e.actor === 'pet')).toHaveLength(0); finish(); await pending;
    expect(vi.mocked(f.host.present).mock.calls.map(([s]) => s?.phase)).toEqual(['streaming', 'complete', 'action']);
    expect(new Set(vi.mocked(f.host.present).mock.calls.map(([s]) => s?.id)).size).toBe(1);
    f.coordinator.cancel(); vi.mocked(f.host.present).mockClear(); delta('不能出现'); expect(f.host.present).not.toHaveBeenCalled();
  });
});
