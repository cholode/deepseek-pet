export interface Rect { x: number; y: number; width: number; height: number }
export const baseViewport = { width: 340, height: 420 };
export const avatarScale = .82;
// Even widths keep the bottom-center anchor stable through repeated expand/shrink cycles.
export const dimensions = (size: number, viewport = baseViewport) => ({ width: 2 * Math.round(viewport.width * size / 2), height: Math.round(viewport.height * size) });
/** Allow wide frame poses to retain their character scale instead of fitting the standing canvas. */
export function frameViewport(canvas: { width: number; height: number }, scale: number) {
  return { width: Math.max(340, Math.min(1024, Math.ceil(canvas.width * scale * avatarScale + 40))), height: Math.max(420, Math.min(1024, Math.ceil(canvas.height * scale * avatarScale + 30))) };
}
/** Reserve transparent space for the complete swing, without shrinking the pet. */
export function rigViewport(canvas: {width:number;height:number}, scale: number,
  inertia: {pivot:{x:number;y:number};maxAngleDeg:number}, anchor: {x:number;y:number}) {
  const base=frameViewport(canvas,scale), limit=inertia.maxAngleDeg*Math.PI/180, k=scale*avatarScale;
  const anchorX=canvas.width*anchor.x, anchorY=canvas.height*anchor.y;
  let radius=canvas.width/2, top=anchorY;
  for(const x of [0,canvas.width])for(const y of [0,canvas.height]) {
    const u=x-inertia.pivot.x,v=y-inertia.pivot.y,angles=[-limit,0,limit];
    // Include interior extrema, not just the two end angles.
    for(const a of [Math.atan2(-v,u),Math.atan2(u,v)])for(const turn of [-Math.PI,0,Math.PI])if(Math.abs(a+turn)<=limit)angles.push(a+turn);
    for(const a of angles){
      radius=Math.max(radius,Math.abs(inertia.pivot.x+u*Math.cos(a)-v*Math.sin(a)-anchorX));
      top=Math.max(top,anchorY-(inertia.pivot.y+u*Math.sin(a)+v*Math.cos(a)));
    }
  }
  return {width:Math.max(base.width,Math.min(1024,Math.ceil(radius*k*2+40))),height:Math.max(base.height,Math.min(1024,Math.ceil(top*k+30)))};
}
export function resizeAtFeet(rect: Rect, size: { width: number; height: number }): Rect {
  return { ...size, x: Math.round(rect.x + (rect.width - size.width) / 2), y: rect.y + rect.height - size.height };
}
export function clampRect(rect: Rect, area: Rect): Rect { return { ...rect, x: Math.round(Math.min(Math.max(rect.x, area.x), area.x + Math.max(0, area.width - rect.width))), y: Math.round(Math.min(Math.max(rect.y, area.y), area.y + Math.max(0, area.height - rect.height))) }; }
/** Closest legal placement across work areas, measured by actual translation. */
export function nearestContainedRect(rect: Rect, areas: Rect[]): Rect {
  if(!areas.length)throw new Error('没有可用显示器');
  const fitting=areas.filter(a=>a.width>=rect.width&&a.height>=rect.height);
  const candidates=(fitting.length?fitting:areas).map(a=>clampRect(rect,a));
  const travel=(r:Rect)=>(r.x-rect.x)**2+(r.y-rect.y)**2;
  return candidates.reduce((best,r)=>travel(r)<travel(best)?r:best);
}
export function nearestArea(rect: Rect, areas: Rect[]): Rect { if (!areas.length) throw new Error('没有可用显示器'); const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2; return [...areas].sort((a, b) => distance(cx, cy, a) - distance(cx, cy, b))[0]; }
function distance(x: number, y: number, r: Rect) { return Math.max(r.x - x, 0, x - r.x - r.width) ** 2 + Math.max(r.y - y, 0, y - r.y - r.height) ** 2; }
export function ease(t: number, kind: string): number { return kind === 'easeInOut' ? t * t * (3 - 2 * t) : kind === 'easeOut' ? 1 - (1 - t) ** 3 : t; }
