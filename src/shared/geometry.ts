export interface Rect { x: number; y: number; width: number; height: number }
export const dimensions = (size: number) => ({ width: Math.round(340 * size), height: Math.round(420 * size) });
export function clampRect(rect: Rect, area: Rect): Rect { return { ...rect, x: Math.round(Math.min(Math.max(rect.x, area.x), area.x + Math.max(0, area.width - rect.width))), y: Math.round(Math.min(Math.max(rect.y, area.y), area.y + Math.max(0, area.height - rect.height))) }; }
export function nearestArea(rect: Rect, areas: Rect[]): Rect { if (!areas.length) throw new Error('没有可用显示器'); const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2; return [...areas].sort((a, b) => distance(cx, cy, a) - distance(cx, cy, b))[0]; }
function distance(x: number, y: number, r: Rect) { return Math.max(r.x - x, 0, x - r.x - r.width) ** 2 + Math.max(r.y - y, 0, y - r.y - r.height) ** 2; }
export function ease(t: number, kind: string): number { return kind === 'easeInOut' ? t * t * (3 - 2 * t) : kind === 'easeOut' ? 1 - (1 - t) ** 3 : t; }
