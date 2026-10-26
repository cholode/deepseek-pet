import { emotionNames, type CompanionData } from '../shared/companion';
import type { DebugState, DesktopState } from '../shared/contracts';
import type { Settings } from '../shared/schema';
import type { QuickPetStatus } from '../shared/pet-chat';
import { decayMood } from '../companion/mood';

type StatusRuntime = { snapshot: Pick<DebugState['snapshot'], 'currentAction'>; groups: Pick<DebugState['groups'][number], 'groupId' | 'name'>[] };
// 只投影状态卡要展示的摘要，不复制模型地址、记忆正文、QQ 资料或凭证。
export function quickPetStatus(data: CompanionData | undefined, debug: StatusRuntime | null, desktop: DesktopState, settings: Settings, now = Date.now()): QuickPetStatus {
  const ready = Boolean(data?.config.enabled && data.config.model.model.trim());
  const current = debug?.snapshot.currentAction;
  const action = current ? debug?.groups.find(g => g.groupId === current.groupId)?.name ?? '动作播放中' : debug ? '站立待机' : '正在准备';
  let mood: QuickPetStatus['mood'] = null;
  if (ready && data?.config.mood.enabled) {
    const decayed = decayMood(data.mood, data.config.mood, now);
    const strongest = emotionNames.reduce((a, b) => decayed.emotions[b] > decayed.emotions[a] ? b : a, 'calm');
    mood = { value: Math.round(Math.max(0, Math.min(100, decayed.value))), emotion: decayed.emotions[strongest] >= 1 ? strongest : 'calm' };
  }
  return {
    mode: ready ? 'ai' : 'normal', action, mood, speechEnabled: ready && Boolean(data?.config.speech.enabled),
    behavior: desktop.suspended ? '已挂起' : !desktop.visible ? '已隐藏' : desktop.dragging ? '正在被拖动' : settings.paused ? '自动活动已暂停' : desktop.chatting ? '陪你互动中' : '自由活动中'
  };
}
