import { describe, expect, it, vi } from 'vitest';
import { fixture, memory, assessment, now } from './companion-fixture';
import type { ToolCall } from '../src/companion/ports';

const call: ToolCall = { id: 'call-1', type: 'function', function: { name: 'read_game', arguments: '{"window":"game"}' } };
describe('决策编排与可替换端口', () => {
  it('模型回应、提炼记忆、情绪和已有动作串成一轮', async () => {
    const f = fixture();
    f.model.complete.mockResolvedValueOnce({ text: '记住啦，喜欢星露谷！', calls: [] }).mockResolvedValueOnce(assessment({ memories: [{ text: '用户喜欢星露谷', evidence: '喜欢星露谷', kind: 'preference', factKey: '用户.游戏' }] }));
    await f.coordinator.chat('我喜欢星露谷');
    expect(f.data.memories[0].evidence).toBe('喜欢星露谷');
    expect(f.data.mood.value).toBeGreaterThan(70);
    expect(f.host.present).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'happy', emotion: 'happy' }));
    expect(f.repository.save).toHaveBeenCalled();
    expect(f.coordinator.busy).toBe(false);
  });
  it('群聊上下文不混入桌面历史、私密记忆、个人约定或工具', async () => {
    const f = fixture(); f.data.config.mcp = { enabled: true, url: 'http://localhost/mcp', allowedTools: ['read_game'] };
    f.data.memories.push(memory({ text: '私密记忆秘密', pinned: true }), memory({ id: 'public', scope: 'public', text: '公开爱好游戏', pinned: true }));
    f.data.goals.push({ id: 'g', text: '秘密约定', dueAt: now, completed: false });
    f.data.events.push({ id: 'desktop', text: '桌面私事', at: now, source: 'desktop', actor: 'user', conversationId: 'desktop' });
    f.model.complete.mockResolvedValueOnce({ text: '你好', calls: [] }).mockResolvedValueOnce(assessment({ memories: [{ text: '群聊信息', kind: 'fact', factKey: '用户.昵称', evidence: '大家好' }] }));
    await f.coordinator.chat('大家好', 'qq-group', 'qq:1', 'qq:group:1');
    const context = JSON.stringify(f.model.complete.mock.calls[0][0]);
    expect(context).toContain('公开爱好游戏');
    for (const privateText of ['私密记忆秘密', '秘密约定', '桌面私事']) expect(context).not.toContain(privateText);
    expect(f.tools.list).not.toHaveBeenCalled(); expect(f.data.memories).toHaveLength(2);
  });
  it('低置信度和伪造原话不写入记忆', async () => {
    const f = fixture();
    f.model.complete.mockResolvedValueOnce({ text: '你好', calls: [] }).mockResolvedValueOnce(assessment({ confidence: 0.2, delta: 8 }));
    await f.coordinator.chat('你好'); expect(f.data.mood.value).toBe(70);
    f.model.complete.mockResolvedValueOnce({ text: '好呀', calls: [] }).mockResolvedValueOnce(assessment({ memories: [{ text: '虚构事实', evidence: '不存在的引文', kind: 'fact', factKey: 'fake' }] }));
    await f.coordinator.chat('继续'); expect(f.data.memories).toHaveLength(0);
  });
  it('评价失败保留正常回复；不会拿自己的发言继续强化情绪', async () => {
    const f = fixture(); f.model.complete.mockResolvedValueOnce({ text: '我很难过', calls: [] }).mockResolvedValueOnce({ text: '非 JSON', calls: [] });
    expect(await f.coordinator.chat('今天天气好')).toBe('我很难过');
    expect(JSON.stringify(f.model.complete.mock.calls[1][0])).not.toContain('我很难过');
    expect(f.coordinator.notice).toContain('提炼未成功'); expect(f.data.mood.value).toBe(70);
  });
  it('取消后即使适配器迟到返回，也不能写入回复、记忆或动作', async () => {
    const f = fixture(); let resolve!: (value: { text: string; calls: [] }) => void;
    f.model.complete.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const promise = f.coordinator.chat('延迟问题'); await vi.waitFor(() => expect(f.model.complete).toHaveBeenCalled());
    f.coordinator.cancel(); resolve({ text: '迟到回复', calls: [] });
    expect(await promise).toBe(''); expect(f.data.events.filter(e => e.actor === 'pet')).toHaveLength(0);
    expect(f.host.present).toHaveBeenCalledTimes(1); expect(f.host.present).toHaveBeenCalledWith(null);
  });
  it('记忆写入超过容量时不会留下半次情绪更新', async () => {
    const f = fixture(); f.data.memories = Array.from({ length: 10000 }, (_, i) => memory({ id: `m${i}` }));
    f.model.complete.mockResolvedValueOnce({ text: '收到', calls: [] }).mockResolvedValueOnce(assessment({ memories: [{ text: '用户喜欢钓鱼', evidence: '喜欢钓鱼', kind: 'preference', factKey: '用户.新爱好' }] }));
    expect(await f.coordinator.chat('喜欢钓鱼')).toBe('收到');
    expect(f.data.mood.value).toBe(70); expect(f.data.mood.timeline).toHaveLength(0);
    expect(f.data.memories).toHaveLength(10000); expect(f.coordinator.notice).toContain('提炼未成功');
  });
  it('相同消息只处理一次，关闭智能陪伴不消耗模型', async () => {
    const f = fixture(); f.model.complete.mockResolvedValueOnce({ text: '你好', calls: [] }).mockResolvedValueOnce(assessment());
    await f.coordinator.chat('你好', 'desktop', 'same'); await f.coordinator.chat('你好', 'desktop', 'same');
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    f.data.config.enabled = false; await expect(f.coordinator.chat('你好')).rejects.toThrow('启用智能陪伴');
  });
  it('只调用已勾选工具，实际结果送回同一决策模型', async () => {
    const f = fixture(); f.data.config.mcp.enabled = true; f.data.config.mcp.allowedTools = ['read_game'];
    f.tools.list.mockResolvedValue([{ name: 'read_game', description: '', inputSchema: { type: 'object' } }, { name: 'delete_file', description: '', inputSchema: {} }]);
    f.tools.call.mockResolvedValue('游戏窗口未打开');
    f.model.complete.mockResolvedValueOnce({ text: '', calls: [call] }).mockResolvedValueOnce({ text: '游戏窗口还没有打开', calls: [] }).mockResolvedValueOnce(assessment());
    await f.coordinator.chat('看看游戏');
    expect(f.tools.call).toHaveBeenCalledWith('read_game', { window: 'game' }, expect.any(AbortSignal));
    expect(f.model.complete.mock.calls[0][3]?.map(t => t.name)).toEqual(['read_game']);
    expect(f.model.complete.mock.calls[1][0]).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '游戏窗口未打开' });
  });
  it('未授权工具仍被拒绝', async () => {
    const f = fixture(); f.model.complete.mockResolvedValue({ text: '', calls: [call] });
    await expect(f.coordinator.chat('工具')).rejects.toThrow('未授权'); expect(f.tools.call).not.toHaveBeenCalled();
  });
  it('跨越旧轮数与次数上限，完整回传每个结果直到模型完成', async () => {
    const f = fixture(); f.data.config.mcp.enabled = true; f.data.config.mcp.allowedTools = ['read_game'];
    f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.tools.list.mockResolvedValue([{ name: 'read_game', description: '', inputSchema: {} }]);
    const ids: string[] = [];
    for (let round = 0; round < 6; round++) {
      const calls = Array.from({ length: round === 0 ? 5 : 1 }, (_, i) => ({ ...call, id: `round-${round}-${i}` }));
      ids.push(...calls.map(c => c.id)); f.model.complete.mockResolvedValueOnce({ text: '', calls });
    }
    f.model.complete.mockImplementationOnce(async messages => {
      expect(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(ids);
      return { text: '十个步骤全部完成', calls: [] };
    });
    expect(await f.coordinator.chat('完成连续任务')).toBe('十个步骤全部完成');
    expect(f.tools.call).toHaveBeenCalledTimes(10); expect(f.model.complete).toHaveBeenCalledTimes(7);
    expect(f.coordinator.busy).toBe(false); expect(f.coordinator.error).toBeUndefined();
  });
  it('连续工具执行仍可停止，迟到工具结果不启动下一轮，随后可重新聊天', async () => {
    const f = fixture(); f.data.config.mcp.enabled = true; f.data.config.mcp.allowedTools = ['read_game'];
    f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.tools.list.mockResolvedValue([{ name: 'read_game', description: '', inputSchema: {} }]);
    f.model.complete.mockResolvedValue({ text: '', calls: [call] });
    let finish!: (text: string) => void; let toolSignal!: AbortSignal; let count = 0;
    f.tools.call.mockImplementation(async (_name, _args, signal) => {
      if (++count < 6) return '继续';
      toolSignal = signal; return new Promise<string>(resolve => { finish = resolve; });
    });
    const pending = f.coordinator.chat('连续工具任务');
    await vi.waitFor(() => expect(f.tools.call).toHaveBeenCalledTimes(6));
    f.coordinator.cancel(); expect(toolSignal.aborted).toBe(true); finish('迟到结果');
    expect(await pending).toBe(''); expect(f.model.complete).toHaveBeenCalledTimes(6);
    expect(f.data.events.filter(e => e.actor === 'pet')).toHaveLength(0); expect(f.coordinator.busy).toBe(false);
    f.model.complete.mockResolvedValueOnce({ text: '可以重新聊天', calls: [] });
    expect(await f.coordinator.chat('你好')).toBe('可以重新聊天');
  });
  it('主动搭话先落盘记账，重启相同时间不会重提；不评价自己的话', async () => {
    const f = fixture(); f.data.config.initiative.enabled = true;
    f.data.goals.push({ id: 'g', text: '测试约定', dueAt: now - 1, completed: false });
    f.model.complete.mockResolvedValue({ text: '到约定时间啦', calls: [] });
    await f.coordinator.tick(); await f.coordinator.tick();
    expect(f.model.complete).toHaveBeenCalledTimes(1); expect(f.data.goals[0].lastAttemptAt).toBe(now);
    expect(f.data.goals[0].completed).toBe(false); expect(f.data.mood.timeline).toHaveLength(0);
  });
});
