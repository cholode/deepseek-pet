import { describe, expect, it, vi } from 'vitest';
import { runTeachingTurn, teachingMethods, teachingMessages, teachingRequest } from '../src/companion/teaching';

const input = { methodId: 'retrieval', title: '身份介绍', knowledge: '名词判断句', history: [{ role: 'user' as const, content: '我不明白，请说短一点。' }], turn: 0 };
describe('教学方法共享执行器', () => {
  it('明确的提示、缩短解释和换题请求不作为作答，带日语的实际答案仍可评价', () => {
    expect(teachingRequest('给我一点提示').hint).toBe(true);
    expect(teachingRequest('你讲得太长了，请讲短一点').control).toBe(true);
    expect(teachingRequest('换一个新场景，先别给我完整答案').control).toBe(true);
    expect(teachingRequest('今天先到这里，我想休息').stop).toBe(true);
    expect(teachingRequest('结束本课并复盘').control).toBe(true);
    expect(teachingRequest('私は学生です。这句可以吗？').control).toBe(false);
    expect(teachingRequest('公司职员').control).toBe(false);
  });
  it('十种工作流具有不同环节，课堂原话和内部答案明确分离', () => {
    expect(teachingMethods).toHaveLength(10); expect(new Set(teachingMethods.map(m => m.stages.join(','))).size).toBe(10);
    const messages = teachingMessages(input); expect(messages[0].content).toContain('主动回忆');
    expect(JSON.parse(messages[1].content!).conversation[0].content).toBe(input.history[0].content);
  });
  it('允许围栏与额外字段，缺少成绩默认为不评分，而非伪造答对', async () => {
    const generate = vi.fn(async () => '```json\n{"reply":"先看一个小例子。","other":"metadata"}\n```');
    expect(await runTeachingTurn(input, generate, new AbortController().signal)).toMatchObject({ reply: '先看一个小例子。', score: null });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('不可用格式只修复一次；协作方案真实多一次教练调用', async () => {
    const generate = vi.fn().mockResolvedValueOnce('不是JSON').mockResolvedValueOnce('{"reply":"这一句可以。","score":2}');
    expect((await runTeachingTurn(input, generate, new AbortController().signal)).score).toBe(2); expect(generate).toHaveBeenCalledTimes(2);
    const team = vi.fn().mockResolvedValueOnce('先指出具体错误。').mockResolvedValueOnce('{"reply":"这里少了名词。"}');
    await runTeachingTurn({ ...input, methodId: 'team' }, team, new AbortController().signal); expect(team).toHaveBeenCalledTimes(2); expect(team.mock.calls[1][0][0].content).toContain('先指出具体错误');
  });
  it('取消后的模型回复不会提交为课堂结果', async () => {
    const controller = new AbortController(); const generate = vi.fn(async () => { controller.abort(); return '{"reply":"迟到回复"}'; });
    await expect(runTeachingTurn(input, generate, controller.signal)).rejects.toThrow();
  });
});
