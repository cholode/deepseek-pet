import { Container, Sprite, type Texture } from 'pixi.js';
import { ease } from '../../shared/geometry';
import type { Motion } from '../../shared/schema';

export type SpriteRig = Extract<Motion, {kind:'sprite_rig'}>;
type SpriteTrack = SpriteRig['tracks'][number];

export function trackValue(track: SpriteTrack, time: number): number {
  const keys = track.keyframes;
  if (time <= keys[0].timeMs) return keys[0].value;
  if (time >= keys.at(-1)!.timeMs) return keys.at(-1)!.value;
  const index = keys.findIndex(k => k.timeMs >= time), a = keys[index - 1], b = keys[index];
  return a.value + (b.value - a.value) * ease((time - a.timeMs) / (b.timeMs - a.timeMs), b.easing);
}

/** Each source component retains its own shoulder/hip/hair-root pivot.
 * Part order is explicit draw order; no generated code is loaded from packs.
 */
export function createSpriteRig(stage: Container, motion: SpriteRig, texture: (file: string) => Texture) {
  const container = new Container();
  const parts = motion.parts.map(definition => {
    const sprite = new Sprite(texture(definition.image));
    sprite.pivot.set(definition.pivotX, definition.pivotY);
    container.addChild(sprite);
    return {sprite, definition, tracks: motion.tracks.filter(t => t.targetId === definition.id)};
  });
  stage.addChild(container);
  let disposed = false;
  const update = (time: number) => {
    if (disposed) return;
    for (const {sprite, definition: p, tracks} of parts) {
      sprite.position.set(p.x, p.y); sprite.scale.set(p.scaleX, p.scaleY); sprite.rotation = 0; sprite.alpha = 1;
      for (const track of tracks) {
        const value = trackValue(track, time);
        switch (track.property) {
          case 'offsetX': sprite.x = p.x + value; break;
          case 'offsetY': sprite.y = p.y + value; break;
          case 'rotationDeg': sprite.rotation = value * Math.PI / 180; break;
          case 'scaleX': sprite.scale.x = p.scaleX * value; break;
          case 'scaleY': sprite.scale.y = p.scaleY * value; break;
          case 'alpha': sprite.alpha = value; break;
        }
      }
    }
  };
  update(0);
  return {update, dispose() { if (disposed) return; disposed = true; container.destroy({children:true}); }};
}
