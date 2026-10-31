import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechDisplay } from '../src/main/voice/display';
import { speechChunks, speechPlan } from '../src/shared/voice';
import { companionDefaults, type CompanionPresentation } from '../src/shared/companion';
import { fixture } from './companion-fixture';

afterEach(() => vi.useRealTimers());
describe('文字跟随实际播放', () => {
  it('首句同步后释放缓存文字，后续 SSE 增量不等待后句合成或播放', () => {
    vi.useFakeTimers(); const visual = vi.fn(), display = new SpeechDisplay(visual, vi.fn());
    const value: CompanionPresentation = { id: 'stream', speechRevision: 0, text: '第一句。第二句还没说完', speechSegments: [{ language: 'zh', text: '第一句。' }], phase: 'streaming', emotion: 'calm', source: 'desktop', speech: { ...companionDefaults.speech, enabled: true } };
    display.present(value); expect(visual.mock.calls.at(-1)?.[0].text).toBe('正在组织回复…');
    display.progress({ type: 'playback-progress', presentationId: 'stream', speechRevision: 0, chunk: 0 });
    expect(visual.mock.calls.at(-1)?.[0].text).toBe('第一句。');
    vi.advanceTimersByTime(16); expect(visual.mock.calls.at(-1)?.[0].text).toBe(value.text);
    display.present({ ...value, text: value.text + '，现在继续。' });
    expect(visual.mock.calls.at(-1)?.[0].text).toContain('现在继续。');
    display.present({ ...value, speechRevision: 1, text: '新一轮' });
    display.progress({ type: 'playback-progress', presentationId: 'stream', speechRevision: 0, finished: true });
    expect(visual.mock.calls.at(-1)?.[0].text).toBe('正在组织回复…'); display.flush();
  });
  it('清理 Markdown 后仍映射到原文边界，代码与图片不会读出来', () => {
    const text = '**你好。**\n[下一句](https://example.com)。\n```js\nignore();\n```\n结束🐟！![图](petsticker://pack/a.gif)';
    const plan = speechPlan(text);
    expect(plan.map(p => p.text)).toEqual(speechChunks(text));
    expect(text.slice(0, plan[0].displayEnd)).toBe('**你好。**');
    expect(text.slice(0, plan[1].displayEnd)).toContain('[下一句](https://example.com)。');
    expect(plan.at(-1)?.displayEnd).toBe(text.length);
    expect(speechPlan('```js\nignore();\n```')).toEqual([]);
    expect(speechPlan('先生', [])).toEqual([]);
  });
  it('混合语言、不同情绪和长 Unicode 句子都保留各自的显示位置', () => {
    const segments = [{ text: '答对啦！', language: 'zh' as const, emotion: 'happy' as const }, { text: '先生', language: 'ja' as const, emotion: 'neutral' as const }, { text: '🐟'.repeat(200), language: 'zh' as const }];
    const text = segments.map(s => s.text).join(''); const plan = speechPlan(text, segments);
    expect(plan.map(p => p.displayEnd)).toEqual([4, 6, 366, 406]);
    expect(plan[1]).toMatchObject({ language: 'ja', emotion: 'neutral', text: '先生' });
    expect(plan.map(p => p.text).join('')).toBe(text);
  });
  it('首音频前不泄露正文，忽略乱序/重复回调；失败停止恢复完整答案且不修改存储', async () => {
    vi.useFakeTimers(); const f = fixture(); const visual = vi.fn(), refresh = vi.fn();
    const display = new SpeechDisplay(visual, refresh);
    const value: CompanionPresentation = { id: 'reply', text: '第一句。第二句。', phase: 'complete', emotion: 'calm', source: 'desktop', speech: { ...companionDefaults.speech, enabled: true } };
    display.present({ ...value, phase: 'streaming' }); expect(visual.mock.calls.at(-1)?.[0].text).toBe('正在组织回复…');
    display.present(value);
    f.data.events.push({ id: value.id, text: value.text, at: 1, source: 'desktop', actor: 'pet', conversationId: 'desktop' });
    const view = f.coordinator.view();
    expect(display.view(view).data.events.at(-1)?.text).toBe('正在准备语音…');
    const advance = (chunk: number) => display.progress({ type: 'playback-progress', presentationId: value.id, chunk });
    advance(1); expect(display.view(view).data.events.at(-1)?.text).toBe('正在准备语音…');
    advance(0); expect(display.view(view).data.events.at(-1)?.text).toBe('第一句。');
    advance(0); expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.data.events.at(-1)?.text).toBe(value.text);
    display.flush(); expect(display.view(view).data.events.at(-1)?.text).toBe(value.text);
    advance(1); expect(visual.mock.calls.at(-1)?.[0]).toMatchObject({ text: value.text, phase: 'complete' });
    display.present({ ...value, speech: { ...value.speech, enabled: false }, phase: 'streaming' });
    expect(visual.mock.calls.at(-1)?.[0].text).toBe(value.text);
  });
  it('超时兜底恢复全文，旧播放完成不覆盖新的回复', () => {
    vi.useFakeTimers(); const visual = vi.fn(); const display = new SpeechDisplay(visual, vi.fn());
    const a: CompanionPresentation = { id: 'a', text: '旧回复。', phase: 'complete', emotion: 'calm', source: 'desktop', speech: { ...companionDefaults.speech, enabled: true } };
    display.present(a); display.present({ ...a, id: 'b', text: '新回复。' });
    display.progress({ type: 'playback-progress', presentationId: 'a', finished: true });
    expect(visual.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'b', text: '正在准备语音…' });
    vi.advanceTimersByTime(240000);
    expect(visual.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'b', text: '新回复。', phase: 'complete' });
    display.flush();
  });
});
