import { clamp, type NodePose, type RigPose } from './pose';

type Point = readonly [number, number];
const joints = {
  Left: { shoulder: [212, 509], elbow: [184, 568], wrist: [155, 634] },
  Right: { shoulder: [396, 509], elbow: [424, 568], wrist: [454, 640] }
} satisfies Record<string, Record<string, Point>>;

function around(x: number, y: number, pivot: Point, node?: NodePose): Point {
  if (!node) return [x, y];
  const angle = clamp(node.rotationDeg, -150, 150) * Math.PI / 180;
  const dx = (x - pivot[0]) * clamp(node.scaleX, .7, 1.5), dy = (y - pivot[1]) * clamp(node.scaleY, .7, 1.5);
  return [pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle) + clamp(node.offsetX, -8, 8) * 915 / 400,
    pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle) + clamp(node.offsetY, -8, 8) * 915 / 400];
}

/** Skin the original sleeve and hand around shoulder/elbow/wrist joints.
 * Coordinates are in the 640 × 915 source sheet; the neutral pose is identity.
 * A shared lower-arm transform keeps the wrist attached while the elbow bends.
 */
export function articulateArm(id: string, x: number, y: number, pose: RigPose): Point {
  if (!/^(Arm|Hand)[LR]$/.test(id)) return [x, y];
  const side = id.endsWith('L') ? 'Left' : 'Right', joint = joints[side];
  const shoulder = pose[`shoulder${side}`], elbow = pose[`elbow${side}`], wrist = pose[`wrist${side}`];
  if (!shoulder && !elbow && !wrist) return [x, y];
  let sx = x * 640 / 280 + 320, sy = (y + 400) * 915 / 400;
  const lowerWeight = id.startsWith('Hand') ? 1 : clamp((sy - joint.elbow[1] + 18) / 36, 0, 1);
  if (id.startsWith('Hand')) [sx, sy] = around(sx, sy, joint.wrist, wrist);
  const bent = around(sx, sy, joint.elbow, elbow);
  sx += (bent[0] - sx) * lowerWeight; sy += (bent[1] - sy) * lowerWeight;
  [sx, sy] = around(sx, sy, joint.shoulder, shoulder);
  return [(sx - 320) * 280 / 640, sy * 400 / 915 - 400];
}

/** Lift the sleeve/hand draw layer together before they cross the chin. */
export function armForeground(id: string, pose: RigPose): boolean {
  if (!/^(Arm|Hand)[LR]$/.test(id)) return false;
  const side = id.endsWith('L') ? 'Left' : 'Right';
  return Math.abs(pose[`shoulder${side}`]?.rotationDeg ?? 0) > 25;
}
