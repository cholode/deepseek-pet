import { Container, Graphics } from 'pixi.js';
import type { RunningLeaf } from './engine';

/** Soft curls rise from both sides of the head with staggered lifetimes. */
export function steamEffect(parent: Container, origin = { x: 0, y: -362 }): RunningLeaf {
  const items = Array.from({ length: 6 }, (_, i) => {
    const g = new Graphics();
    g.moveTo(0, 12).bezierCurveTo(-12, 3, 12, -5, 1, -15)
      .stroke({ color: 0x9ab9d7, alpha: .45, width: 8, cap: 'round' });
    g.moveTo(0, 12).bezierCurveTo(-12, 3, 12, -5, 1, -15)
      .stroke({ color: 0xf4fbff, width: 5, cap: 'round' });
    g.moveTo(-6,-15).bezierCurveTo(-14,-20,-8,-29,-2,-25)
      .bezierCurveTo(2,-33,13,-28,10,-22).bezierCurveTo(17,-16,6,-10,-6,-15)
      .fill({color:0xf4fbff,alpha:.85}).stroke({color:0x9ab9d7,alpha:.4,width:1.1});
    g.alpha = 0; g.label = `steam-${i}`; parent.addChild(g); return g;
  });
  return {
    update(ms) {
      items.forEach((g, i) => {
        const age = ms - Math.floor(i / 2) * 460;
        if (age < 0) { g.alpha = 0; return; }
        const p = (age % 1600) / 1600, side = i % 2 ? 1 : -1;
        g.position.set(origin.x + side * (62 + 10 * p) + Math.sin(p * Math.PI * 2 + i) * 4, origin.y - p * 67);
        g.scale.set(.7 + p * .45); g.alpha = Math.sin(Math.PI * p) * .9;
      });
    },
    dispose() { items.forEach(g => g.destroy()); }
  };
}
