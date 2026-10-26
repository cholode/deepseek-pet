import { describe, expect, it } from 'vitest';
import { chatAnchors, inputBarLayout, speechBubbleLayout, HoverChatPolicy } from '../src/shared/chat-layout';
import type { Rect } from '../src/shared/geometry';

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const regions = [{ target: 'head' as const, x: 70, y: 85, width: 200, height: 170 }, { target: 'body' as const, x: 88, y: 241, width: 217, height: 168 }];
describe('悬停聊天与独立气泡布局', () => {
  it('短暂停留才打开，跨越窗口间隙不会闪退', () => {
    const p = new HoverChatPolicy();
    expect(p.update(0, true, false, false, false)).toBe(false);
    expect(p.update(239, true, false, false, false)).toBe(false);
    expect(p.update(240, true, false, false, false)).toBe(true);
    expect(p.update(800, false, false, false, false)).toBe(true);
    expect(p.update(1000, false, true, false, false)).toBe(true);
    expect(p.update(1999, false, false, false, false)).toBe(true);
    expect(p.update(2000, false, false, false, false)).toBe(false);
  });
  it('草稿或思考保留输入框；拖动仍立即隐藏；关闭需移开后重新进入', () => {
    const p = new HoverChatPolicy(); p.update(0, true, false, false, false); p.update(250, true, false, false, false);
    expect(p.update(9000, false, false, true, false)).toBe(true);
    expect(p.update(9001, true, false, true, true)).toBe(false);
    p.update(9100, true, false, true, false); expect(p.update(9400, true, false, true, false)).toBe(true);
    p.dismiss(); expect(p.update(10000, true, false, true, false)).toBe(false);
    p.update(10100, false, false, false, false); p.update(10200, true, false, false, false);
    expect(p.update(10500, true, false, false, false)).toBe(true);
  });
  it.each([{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1920, y: -500, width: 1920, height: 1040 }])('角落与负坐标屏幕内都完整显示 $x', area => {
    for (const x of [area.x, area.x + area.width - 340]) for (const y of [area.y, area.y + area.height - 420]) {
      const pet = { x, y, width: 340, height: 420 };
      const lift = inputBarLayout(chatAnchors(pet, regions), area).lift;
      const anchor = chatAnchors({ ...pet, y: pet.y - lift }, regions);
      const bubble = speechBubbleLayout(anchor, { width: 352, height: 296 }, area).bounds;
      const chat = inputBarLayout(anchor, area).bounds;
      for (const rect of [bubble, chat]) { expect(rect.x).toBeGreaterThanOrEqual(area.x); expect(rect.y).toBeGreaterThanOrEqual(area.y); expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width); expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height); expect(intersects(rect, anchor.figure)).toBe(false); }
      expect(intersects(bubble, chat)).toBe(false);
      expect(chat.y).toBe(anchor.feet.y + 3); expect(chat.height).toBe(58);
    }
  });
  it('气泡随内容伸缩，尖角保持在实际头顶 6px 处，排除画布空白', () => {
    const pet = { x: 800, y: 500, width: 340, height: 420 }; const original = { ...pet }; const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const anchor = chatAnchors(pet, regions);
    for (const size of [{ width: 152, height: 77 }, { width: 352, height: 296 }]) {
      const bubble = speechBubbleLayout(anchor, size, area); expect(bubble.bounds.width).toBe(size.width);
      expect(bubble.tail.side).toBe('bottom'); expect(bubble.bounds.y + bubble.bounds.height - 4).toBe(anchor.head.y - 6);
      expect(bubble.bounds.x + bubble.tail.offset).toBe(anchor.head.x + anchor.head.width / 2);
    }
    expect(pet).toEqual(original);
  });
  it('屏幕上沿长回复改在头侧，尖角指回头部', () => {
    const anchor = chatAnchors({ x: 800, y: 0, width: 340, height: 420 }, regions);
    const bubble = speechBubbleLayout(anchor, { width: 352, height: 240 }, { x: 0, y: 0, width: 1920, height: 1040 });
    expect(bubble.tail.side).toBe('left'); expect(bubble.bounds.x + 4).toBe(anchor.figure.x + anchor.figure.width + 6);
    expect(Math.abs(bubble.bounds.y + bubble.tail.offset - anchor.head.y - anchor.head.height * .48)).toBeLessThanOrEqual(1);
  });
  it('靠底部只抬起输入条需要的高度，关闭时可恢复原位置', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }, pet = { x: 800, y: 620, width: 340, height: 420 };
    const layout = inputBarLayout(chatAnchors(pet, regions), area); expect(layout.lift).toBe(50);
    const raised = chatAnchors({ ...pet, y: pet.y - layout.lift }, regions);
    expect(inputBarLayout(raised, area).lift).toBe(0); expect(inputBarLayout(raised, area).bounds.y).toBe(raised.feet.y + 3);
  });
});
