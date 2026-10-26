import { clampRect, type Rect } from './geometry';
import type { HitRegion } from './contracts';
import type { QuickChatTab, SpeechTail } from './pet-chat';

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export interface ChatAnchors { head: Rect; figure: Rect; feet: { x: number; y: number } }
// 输入区/状态卡共用脚下菜单，原生窗口按选中页调整，避免留下挡鼠标的透明区域。
export const inputBarSize = { width: 320, height: 94 };
export const statusPanelSize = { width: 320, height: 224 };
export const quickPanelSize = (tab: QuickChatTab) => tab === 'status' ? statusPanelSize : inputBarSize;

// 使用实际姿态的命中区域，排除透明画布；睡觉、坐下和角色缩放也沿用同一套锚点。
export function chatAnchors(window: Rect, regions: readonly HitRegion[]): ChatAnchors {
  const valid = regions.filter(r => r.width > 0 && r.height > 0);
  const head = valid.find(r => r.target === 'head') ?? { x: window.width * .2, y: window.height * .2, width: window.width * .6, height: window.height * .4 };
  const local = valid.length ? valid : [head, { x: window.width * .25, y: window.height * .6, width: window.width * .5, height: window.height * .36 }];
  const x = Math.min(...local.map(r => r.x)), y = Math.min(...local.map(r => r.y));
  const right = Math.max(...local.map(r => r.x + r.width)), bottom = Math.max(...local.map(r => r.y + r.height));
  return { head: { x: window.x + head.x, y: window.y + head.y, width: head.width, height: head.height },
    figure: { x: window.x + x, y: window.y + y, width: right - x, height: bottom - y },
    feet: { x: window.x + window.width / 2, y: window.y + bottom } };
}

export function inputBarLayout(anchor: ChatAnchors, area: Rect, tab: QuickChatTab = 'chat') {
  const panel = quickPanelSize(tab);
  const size = { width: Math.min(panel.width, area.width), height: Math.min(panel.height, area.height) };
  const desired = { ...size, x: anchor.feet.x - size.width / 2, y: anchor.feet.y + 3 };
  return { bounds: clampRect(desired, area), lift: Math.ceil(Math.max(0, desired.y + size.height - area.y - area.height)) };
}

export function speechBubbleLayout(anchor: ChatAnchors, size: { width: number; height: number }, area: Rect): { bounds: Rect; tail: SpeechTail } {
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const head = anchor.head, cx = head.x + head.width / 2, cy = head.y + head.height * .48;
  // 尖角藏在 16px 透明内边距内，尖端距头部约 6px；上方空间不足时换到左右。
  const choices: { side: SpeechTail['side']; bounds: Rect; target: number }[] = [
    { side: 'bottom', bounds: { x: cx - width / 2, y: head.y - height - 2, width, height }, target: cx },
    { side: 'left', bounds: { x: anchor.figure.x + anchor.figure.width + 2, y: cy - height / 2, width, height }, target: cy },
    { side: 'right', bounds: { x: anchor.figure.x - width - 2, y: cy - height / 2, width, height }, target: cy }
  ];
  const candidate = choices.map((choice, index) => {
    const bounds = clampRect(choice.bounds, area);
    return { ...choice, bounds, score: overlap(bounds, anchor.figure) * 10 + Math.abs(bounds.x - choice.bounds.x) + Math.abs(bounds.y - choice.bounds.y) + index / 10 };
  }).sort((a, b) => a.score - b.score)[0];
  const vertical = candidate.side === 'left' || candidate.side === 'right';
  const length = vertical ? height : width, start = vertical ? candidate.bounds.y : candidate.bounds.x;
  return { bounds: candidate.bounds, tail: { side: candidate.side, offset: Math.round(Math.max(28, Math.min(length - 28, candidate.target - start))) } };
}

// 进入需短暂停留；离开留出跨窗口间隙的时间。关闭后必须先移开再进入。
export class HoverChatPolicy {
  open = false; private enteredAt?: number; private lastInside = 0; private dismissed = false;
  dismiss() { this.open = false; this.enteredAt = undefined; this.dismissed = true; }
  update(now: number, overPet: boolean, overChat: boolean, hold: boolean, blocked: boolean): boolean {
    if (blocked) { this.open = false; this.enteredAt = undefined; return false; }
    if (this.dismissed) { if (!overPet && !overChat) this.dismissed = false; return false; }
    if (!this.open) {
      if (!overPet) this.enteredAt = undefined;
      else { this.enteredAt ??= now; if (now - this.enteredAt >= 240) { this.open = true; this.lastInside = now; } }
    } else {
      if (overPet || overChat || hold) this.lastInside = now;
      else if (now - this.lastInside >= 1000) { this.open = false; this.enteredAt = undefined; }
    }
    return this.open;
  }
}
