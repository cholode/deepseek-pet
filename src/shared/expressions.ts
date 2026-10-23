export const expressionIds = ['neutral', 'smile', 'shy', 'annoyed', 'sleep', 'surprised', 'confused', 'sad'] as const;
export type ExpressionId = typeof expressionIds[number];
interface ExpressionProfile {
  label: string;
  eyes: readonly [number, number];
  gaze?: readonly [number, number];
  blush?: number;
  parameters: Record<string, number>;
}

/** Finite, local model presets. Action packs refer to IDs, never executable code. */
export const expressionProfiles: Record<ExpressionId, ExpressionProfile> = {
  neutral: { label: '默认', eyes: [1, 1], parameters: {} },
  smile: { label: '开心', eyes: [0, 0], blush: .18, parameters: { ParamEyeSmile: 1, ParamMouthActive: 1, ParamMouthForm: 1, ParamMouthOpenY: .65 } },
  shy: { label: '害羞', eyes: [.85, .85], gaze: [-.15, .25], blush: .28, parameters: { ParamBrowForm: -.15, ParamMouthActive: 1, ParamMouthForm: .65, ParamMouthOpenY: .08 } },
  annoyed: { label: '小小抗议', eyes: [.55, .55], parameters: { ParamBrowForm: 1, ParamMouthActive: 1, ParamMouthForm: -.65, ParamMouthOpenY: .1 } },
  sleep: { label: '闭眼休息', eyes: [0, 0], parameters: {} },
  surprised: { label: '惊讶', eyes: [1, 1], parameters: { ParamBrowForm: -.25, ParamMouthActive: 1, ParamMouthOpenY: 1 } },
  confused: { label: '疑惑', eyes: [1, .82], gaze: [.3, -.12], parameters: { ParamBrowAsym: 1, ParamMouthActive: 1, ParamMouthTwist: -.65, ParamMouthOpenY: .1 } },
  sad: { label: '委屈', eyes: [.8, .8], gaze: [0, .35], parameters: { ParamBrowForm: -.9, ParamMouthActive: 1, ParamMouthForm: -.9, ParamTear: .8 } },
};

export const neutralFaceParameters = { ParamBrowForm: 0, ParamBrowAsym: 0, ParamEyeSmile: 0, ParamMouthActive: 0, ParamMouthForm: 0, ParamMouthOpenY: 0, ParamMouthTwist: 0, ParamTear: 0 };
export function expressionProfile(id: string): ExpressionProfile {
  return Object.hasOwn(expressionProfiles, id) ? expressionProfiles[id as ExpressionId] : expressionProfiles.neutral;
}
