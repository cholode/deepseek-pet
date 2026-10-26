import { describe, expect, it } from 'vitest';
import { applyEmotion, decayMood, initialMood } from '../src/companion/mood';
import { recallMemories, remember } from '../src/companion/memory';
import { chooseInitiative, localDay } from '../src/companion/initiative';
import { companionDefaults } from '../src/shared/companion';
import { fixture, memory, now } from './companion-fixture';

describe('情绪连续衰减与外部事件', () => {
  it('频繁采样和一次计算得到相同结果，不因四舍五入卡住', () => {
    const config = companionDefaults.mood;
    const start = applyEmotion(initialMood(now), 'touch', 'happy', 6, '摸头', 1, config, now);
    let frequent = start;
    for (let t = 1000; t <= 3600000; t += 1000) frequent = decayMood(frequent, config, now + t);
    const once = decayMood(start, config, now + 3600000);
    expect(frequent.value).toBeCloseTo(once.value, 9);
    expect(frequent.emotions.happy).toBeCloseTo(once.emotions.happy, 9);
    expect(once.value).toBeLessThan(start.value);
  });
  it('低置信度、关闭情绪和重复事件都不改变心情', () => {
    const config = companionDefaults.mood; const start = initialMood(now);
    expect(applyEmotion(start, 'x', 'frustrated', -8, '', 0.3, config, now)).toEqual(start);
    expect(applyEmotion(start, 'x', 'happy', 8, '', 1, { ...config, enabled: false }, now)).toEqual(start);
    const changed = applyEmotion(start, 'x', 'happy', 6, '', 1, config, now);
    expect(applyEmotion(changed, 'x', 'happy', 6, '', 1, config, now)).toEqual(changed);
  });
  it('系统时钟后退不放大情绪', () => {
    const m = { ...initialMood(now), value: 80 };
    expect(decayMood(m, companionDefaults.mood, now - 60000)).toEqual(m);
  });
});
describe('可追溯的持久记忆', () => {
  const config = companionDefaults.memory;
  it('公开召回隔离私人记录，删除和被替代的记录不可召回', () => {
    const list = [memory({ id: 'private', pinned: true }), memory({ id: 'public', scope: 'public' }), memory({ id: 'deleted', scope: 'public', deletedAt: now }), memory({ id: 'old', scope: 'public', supersededBy: 'public' })];
    expect(recallMemories(list, '星露谷', 'public', config, now).map(m => m.id)).toEqual(['public']);
  });
  it('只有相关经历参与排序，长期事实不随时间衰减', () => {
    const current = memory({ id: 'new' }); const old = memory({ id: 'old', eventAt: now - 365 * 86400000 });
    const hits = recallMemories([old, current, memory({ id: 'irrelevant', text: '早餐吃苹果' })], '星露谷', 'private', config, now);
    expect(hits.map(h => h.id)).toEqual(['new', 'old']);
    const fact = memory({ kind: 'fact' });
    expect(recallMemories([fact], '星露谷', 'private', config, now)[0].score).toEqual(recallMemories([fact], '星露谷', 'private', config, now + 365 * 86400000)[0].score);
  });
  it('新事实保留替代关系，同文不重复保存', () => {
    const first = memory({ factKey: '用户.游戏', text: '喜欢星露谷' });
    const next = memory({ id: 'new', factKey: first.factKey, text: '现在喜欢泰拉瑞亚' });
    const list = remember([first], next);
    expect(list[0].supersededBy).toBe('new');
    expect(remember(list, { ...next, id: 'duplicate' })).toHaveLength(2);
  });
  it('模型推测不能覆盖用户手动确认的事实', () => {
    const first = memory({ sourceId: 'manual', factKey: '用户.游戏' });
    const next = memory({ id: 'next', text: '其他游戏', factKey: first.factKey });
    expect(remember([first], next)).toEqual([first]);
    expect(remember([first], { ...next, sourceId: 'manual' })[0].supersededBy).toBe('next');
  });
});
describe('有动机且克制的主动搭话', () => {
  it('无话题不打扰，到期约定优先于回忆', () => {
    const { data } = fixture(); data.config.initiative.enabled = true;
    expect(chooseInitiative(data, now, false, 0)).toBeUndefined();
    data.memories.push(memory()); data.goals.push({ id: 'g', text: '试一关游戏', dueAt: now - 1, completed: false });
    expect(chooseInitiative(data, now, false, 0)?.goal?.id).toBe('g');
  });
  it('安静时段支持跨午夜，并尊重忙碌、互动、冷却和日预算', () => {
    const { data } = fixture(); data.config.initiative.enabled = true; data.memories.push(memory());
    for (const hour of [23, 2, 7]) expect(chooseInitiative(data, new Date(2026, 9, 25, hour).getTime(), false, 0)).toBeUndefined();
    expect(chooseInitiative(data, now, true, 0)).toBeUndefined();
    expect(chooseInitiative(data, now, false, now)).toBeUndefined();
    data.initiative.lastAt = now - 1000; expect(chooseInitiative(data, now, false, 0)).toBeUndefined();
    data.initiative.lastAt = 0; data.initiative.day = localDay(now); data.initiative.count = 4;
    expect(chooseInitiative(data, now, false, 0)).toBeUndefined();
    data.initiative.day = 'yesterday'; expect(chooseInitiative(data, now, false, 0)).toBeDefined();
  });
});
