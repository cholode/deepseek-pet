import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Motion } from '../../shared/schema';

type FrameMotion = Extract<Motion, { kind: 'frame_animation' }>;

/** Atlas cells share the body's frame index and texture source; no copied GPU images. */
export function createFrameOverlays(stage: Container, motion: FrameMotion, texture: (file: string) => Texture) {
  const items: { sprite: Sprite; view: Texture; definition: NonNullable<FrameMotion['frameOverlays']>[number] }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { sprite, view } of items) { sprite.destroy(); view.destroy(false); }
  };
  try {
    for (const definition of motion.frameOverlays ?? []) {
      const atlas = texture(definition.image);
      const padding = definition.padding ?? 0;
      const view = new Texture({ source: atlas.source, frame: new Rectangle(padding, padding, definition.width, definition.height), dynamic: true });
      const sprite = new Sprite(view);
      sprite.position.set(definition.x, definition.y);
      stage.addChild(sprite);
      items.push({ sprite, view, definition });
    }
  } catch (error) { dispose(); throw error; }
  return {
    update(index: number) {
      if (disposed) return;
      for (const { view, definition } of items) {
        const padding = definition.padding ?? 0;
        view.frame.x = (index % definition.columns) * (definition.width + padding * 2) + padding;
        view.frame.y = Math.floor(index / definition.columns) * (definition.height + padding * 2) + padding;
        view.update();
      }
    },
    dispose
  };
}
