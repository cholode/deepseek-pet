import type { ActionChannel } from '../../../shared/schema';
import { expressionProfile, neutralFaceParameters } from '../../../shared/expressions';
import { articulateArm } from './arms';

export interface NodePose { offsetX: number; offsetY: number; rotationDeg: number; scaleX: number; scaleY: number; alpha: number }
export type RigPose = Record<string, NodePose>;
export const neutralNode = (): NodePose => ({ offsetX: 0, offsetY: 0, rotationDeg: 0, scaleX: 1, scaleY: 1, alpha: 1 });
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Bind stable action-pack nodes to the approved model's finite parameter ranges. */
export function parametersFor(pose: RigPose, time: number, occupied: ActionChannel[], face: string, gaze: {x: number; y: number}, blink: number, faceWeight=1): Record<string, number> {
  const get = (id: string) => pose[id] ?? neutralNode();
  const idlePose = !occupied.includes('pose'), idleFace = !occupied.includes('face');
  const expression = expressionProfile(face), eyeScale = get('eyes').scaleY * (idleFace ? blink : 1);
  const weight=clamp(faceWeight,0,1),faceParameters=Object.fromEntries(Object.entries(expression.parameters).map(([id,value])=>[id,value*weight]));
  return {
    ...neutralFaceParameters, ...faceParameters,
    ParamAngleZ: clamp(get('head').rotationDeg / 3 + (idlePose ? gaze.x * .65 + Math.sin(time / 1750) * .65 : 0), -4, 4),
    ParamBodyAngleZ: clamp(get('body').rotationDeg / 6, -1.2, 1.2),
    ParamBreath: idlePose ? (1 - Math.cos(time / 750)) / 2 : 0,
    ParamEyeLOpen: clamp(eyeScale * (1+(expression.eyes[0]-1)*weight), 0, 1), ParamEyeROpen: clamp(eyeScale * (1+(expression.eyes[1]-1)*weight), 0, 1),
    ParamEyeBallX: clamp((idleFace ? gaze.x : expression.gaze?.[0] ?? 0) + get('eyes').offsetX / 4, -1, 1),
    ParamEyeBallY: clamp((idleFace ? gaze.y : expression.gaze?.[1] ?? 0) + get('eyes').offsetY / 3, -1, 1),
    ParamTail: clamp(get('tail').rotationDeg / 8 + (idlePose ? Math.sin(time / 1400) * .55 : 0), -1, 1),
    ParamHairBack: clamp(get('hairBack').rotationDeg / 10 + (idlePose ? Math.sin(time / 1600 - .8) * .3 : 0), -1, 1),
    ParamHairFront: clamp(get('hairFront').rotationDeg / 8 + (idlePose ? Math.sin(time / 1600 - .3) * .3 : 0), -1, 1),
    ParamAhoge: idlePose ? Math.sin(time / 1400 - .9) * .4 : 0,
    ParamEarL: idlePose ? Math.sin(time / 2100) * .3 : 0,
    ParamEarR: idlePose ? -Math.sin(time / 2100) * .3 : 0,
    ParamArmL: clamp(get('armLeft').rotationDeg / 110, -1, 1),
    ParamArmR: clamp(get('armRight').rotationDeg / 110, -1, 1),
    ParamSkirt: idlePose ? Math.sin(time / 1800 - .6) * .3 : 0
  };
}

const meshNodes: Record<string, string[]> = {
  BackHair: ['hairBack'], Dress: ['body'], Neck: ['body'], LegL: [], LegR: [], Tail: ['tail', 'body'],
  ArmL: ['armLeft'], HandL: ['armLeft'], ArmR: ['armRight'], HandR: ['armRight'],
  BangCenter: ['hairFront', 'head'], FrontHair: ['head'], HeadBase: ['head'],
  Headband: ['head'], Ahoge: ['head'], EarL: ['head'], EarR: ['head'], BowR: ['head'],
  EyeOpenL: ['eyes', 'head'], EyeOpenR: ['eyes', 'head'], EyeLashL: ['eyes', 'head'], EyeLashR: ['eyes', 'head'],
  EyeClosedL: ['eyes', 'head'], EyeClosedR: ['eyes', 'head'], EyeIrisL: ['eyes', 'head'], EyeIrisR: ['eyes', 'head'], Mouth: ['mouth', 'head'],
  EyeCreaseL: ['eyes', 'head'], EyeCreaseR: ['eyes', 'head'], EyeLidEdgeR: ['eyes', 'head'],
  MouthFill: ['mouth', 'head'], MouthLip: ['mouth', 'head'], MouthTongue: ['mouth', 'head'], MouthTeeth: ['mouth', 'head'],
  TearL: ['eyes', 'head'], TearR: ['eyes', 'head'], TearGlintL: ['eyes', 'head'], TearGlintR: ['eyes', 'head']
};
const pivots: Record<string, [number, number]> = { body: [-6.56,-148.63], head: [-6.56,-194.1], hairBack: [-6.56,-299.45], hairFront: [-14,-340.1], armLeft: [-47.25,-177.49], armRight: [33.25,-177.49], tail: [69.13,-91.8], eyes: [-6.56,-226], mouth: [-9.63,-206.34] };

/** Apply extra timeline translations/scales to each bound mesh, including its clipping mask.
 * Rotations are evaluated by Cubism; only a bounded shoulder gesture augments arm keyforms.
 * Root transforms stay in Pixi, so hops/mirroring never move the window or bubble text.
 */
export function transformMesh(id: string, source: Float32Array, target: Float32Array, pose: RigPose): number {
  const chain = meshNodes[id] ?? []; let alpha = 1;
  for (const node of chain) alpha *= pose[node]?.alpha ?? 1;
  const arm=/^(Arm|Hand)[LR]$/.test(id);
  if(arm){
    const side=id.endsWith('L')?'Left':'Right';
    for(const joint of id.startsWith('Hand')?['shoulder','elbow','wrist']:['shoulder','elbow'])alpha*=pose[joint+side]?.alpha??1;
  }
  for (let i = 0; i < source.length; i += 2) {
    let x = source[i] * 140, y = -200 - source[i+1] * (400 * 320 / 915);
    if(arm)[x, y] = articulateArm(id, x, y, pose);
    if (id === 'BackHair' && pose.head) {
      // Match the rear-hair head/torso weighting in the Cubism mesh. Its roots
      // must follow timeline nods as well as Core rotations; tips stay anchored.
      const weight = 1 - clamp(((y + 400) * 915 / 400 - 435) / 255, 0, 1);
      const p = pose.head, [px, py] = pivots.head;
      x += ((x - px) * (clamp(p.scaleX,.94,1.06)-1) + clamp(p.offsetX,-8,8)) * weight;
      y += ((y - py) * (clamp(p.scaleY,.94,1.06)-1) + clamp(p.offsetY,-8,8)) * weight;
    }
    for (const id of chain) {
      const p = pose[id]; if (!p) continue;
      const [px,py] = pivots[id];
      const eye = id === 'eyes'; // Eye geometry and gaze already belong to the Core parameters.
      const rotation = id.startsWith('arm') ? clamp(p.rotationDeg / 9, -12, 12) * Math.PI / 180 : 0;
      const sx = eye ? 1 : clamp(p.scaleX,.94,1.06), sy = eye ? 1 : clamp(p.scaleY,.94,1.06);
      const dx = (x-px)*sx, dy = (y-py)*sy;
      x = px + dx*Math.cos(rotation)-dy*Math.sin(rotation) + (eye ? 0 : clamp(p.offsetX,-8,8));
      y = py + dx*Math.sin(rotation)+dy*Math.cos(rotation) + (eye ? 0 : clamp(p.offsetY,-8,8));
    }
    target[i] = x / 140 * .96; target[i+1] = -(y+200) / 200 * .96;
  }
  return alpha;
}
