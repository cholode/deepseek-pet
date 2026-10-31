import { describe, expect, it, vi } from 'vitest';
import { isSimpleGreeting } from '../src/shared/greeting';
import { fixture } from './companion-fixture';
import { CompanionCoordinator } from '../src/companion/coordinator';

describe('纯问候快速回复', () => {
  it('只匹配独立招呼，含软件任务、学习请求、时间问题都走正常工具链', () => {
    for (const text of ['上午好', '你好呀！', 'Hi!', 'おはようございます。']) expect(isSimpleGreeting(text)).toBe(true);
    for (const text of ['上午好，打开 Anki', '早上好，继续教我日语', '现在上午几点', '你好，搜一下资料', '你好老师，我的答案是 A']) expect(isSimpleGreeting(text)).toBe(false);
  });
  it('不发现工具或多轮选表情，仍调用模型及宿主表情装饰；真实任务不跳过工具', async () => {
    const f = fixture(); f.data.config.mood.enabled = false; f.data.config.memory.automatic = false; f.data.config.mcp.enabled = true;
    const software = { beginTurn: vi.fn(), context: vi.fn(() => '软件配置'), list: vi.fn(async () => []), call: vi.fn(async () => ''), close: vi.fn(async () => {}), decorateReply: vi.fn(async (text: string) => `${text}\n![表情](petsticker://local/a.gif)`) };
    const coordinator = new CompanionCoordinator(f.repository, f.model, f.tools, f.host, software);
    f.model.complete.mockResolvedValue({ text: '上午好呀。', calls: [] }); await coordinator.chat('上午好');
    expect(f.tools.list).not.toHaveBeenCalled(); expect(software.list).not.toHaveBeenCalled(); expect(software.context).not.toHaveBeenCalled();
    expect(software.beginTurn).toHaveBeenCalled(); expect(software.decorateReply).toHaveBeenCalled(); expect(f.model.complete).toHaveBeenCalledTimes(1);
    expect(f.data.events.at(-1)?.text).toContain('![表情]');
    await coordinator.chat('上午好，打开 Anki'); expect(software.list).toHaveBeenCalledTimes(1); expect(f.tools.list).toHaveBeenCalledTimes(1);
    await coordinator.chat('练习日语翻译'); await coordinator.chat('你好');
    expect(software.list).toHaveBeenCalledTimes(3); // 问候词也可能是学习任务的真实回答。
  });
});
