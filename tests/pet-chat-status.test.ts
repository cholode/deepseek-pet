import { describe, expect, it } from 'vitest';
import { quickPetStatus } from '../src/main/pet-chat-status';
import { defaults } from '../src/shared/schema';
import type { DesktopState } from '../src/shared/contracts';
import { fixture, now } from './companion-fixture';

const desktop: DesktopState = { visible: true, suspended: false, dragging: false, pointerNear: true, position: { x: 0, y: 0 } };
const idle = { snapshot: { currentAction: null }, groups: [] };
describe('悬停菜单的实时状态摘要', () => {
  it('未配置时也能查看普通状态，不把默认心情伪装成启用的情绪', () => {
    const { data } = fixture(); data.config.enabled = false;
    expect(quickPetStatus(data, idle, desktop, defaults, now)).toEqual({ mode: 'normal', action: '站立待机', behavior: '自由活动中', mood: null, speechEnabled: false });
    expect(quickPetStatus(undefined, null, desktop, defaults, now).action).toBe('正在准备');
  });
  it('显示当前动作包的实际名称以及暂停/互动状态，不依赖内置动作 ID', () => {
    const runtime = { snapshot: { currentAction: { actionInstanceId: '1', groupId: 'user.demo:wave', source: 'manual' as const, elapsedMs: 10 } }, groups: [{ groupId: 'user.demo:wave', name: '自定义挥手' }] };
    expect(quickPetStatus(undefined, runtime, desktop, defaults, now).action).toBe('自定义挥手');
    expect(quickPetStatus(undefined, idle, { ...desktop, chatting: true }, defaults, now).behavior).toBe('陪你互动中');
    expect(quickPetStatus(undefined, idle, { ...desktop, chatting: true }, { ...defaults, paused: true }, now).behavior).toBe('自动活动已暂停');
  });
  it('心情按当前时间衰减，摘要不包含配置或记忆，也不修改持久状态', () => {
    const { data } = fixture(); data.mood.value = 88; data.mood.emotions.happy = 8; data.config.speech.enabled = true;
    const before = structuredClone(data);
    const value = quickPetStatus(data, idle, desktop, defaults, now);
    expect(value).toEqual({ mode: 'ai', action: '站立待机', behavior: '自由活动中', mood: { value: 88, emotion: 'happy' }, speechEnabled: true });
    expect(quickPetStatus(data, idle, desktop, defaults, now + 12 * 3600000).mood).toEqual({ value: 79, emotion: 'calm' });
    expect(data).toEqual(before);
    data.config.mood.enabled = false;
    expect(quickPetStatus(data, idle, desktop, defaults, now).mood).toBeNull();
  });
});
