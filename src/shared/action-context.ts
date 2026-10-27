import type { GroupInfo } from './schema';

export interface SoftwareActionContext {
  softwareOperating?: boolean;
  interacting?: boolean;
  pointerNear: boolean;
  lastInteraction: number;
  paused?: boolean;
}

/** 情境限制适用于所有动作入口，随机权重和用户覆盖不能绕过它。 */
export function softwareActionAllowed(group: Pick<GroupInfo, 'conditions'>, state: SoftwareActionContext, now: number): boolean {
  return !group.conditions.requiresSoftwareOperation || Boolean(
    state.softwareOperating && !state.paused && !state.interacting && !state.pointerNear &&
    now - state.lastInteraction >= group.conditions.minIdleMs
  );
}
