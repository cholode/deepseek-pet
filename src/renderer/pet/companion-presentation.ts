import type { CompanionPresentation } from '../../shared/companion';
import type { PetRuntime } from './PetRuntime';
import { VoicePlayer } from '../voice/player';

// 原生气泡独立排版；此处只负责语音和角色动作，增量文字不能反复触发朗读。
export function mountCompanionPresentation(runtime: PetRuntime) {
  const spoken = new Set<string>(); const player = new VoicePlayer();
  let queue: CompanionPresentation[] = []; let speaking = false; let epoch = 0;
  const stop = () => { epoch++; queue = []; speaking = false; player.stop(); };
  const speakNext = async () => {
    if (speaking || !queue.length) return;
    const item = queue.shift()!; const current = epoch; speaking = true;
    try { await player.speak(item.text); }
    catch (error) { if (current === epoch) void window.pet.voice({ type: 'report-error', message: error instanceof Error ? error.message : '朗读失败' }); }
    finally { if (epoch === current) { speaking = false; void speakNext(); } }
  };
  const offVoice = window.pet.onVoice(event => { if (event.type !== 'state') stop(); });
  const off = window.pet.onPresentation(item => {
    if (!item) { stop(); return; }
    if (item.phase === 'streaming') return;
    if (item.groupId) void runtime.port('ai').submit({ protocolVersion: 1, type: 'play_group', commandId: item.id, groupId: item.groupId, expiresAtUnixMs: Date.now() + 3000 });
    if (item.phase !== 'action' && item.speech.enabled && !spoken.has(item.id)) {
      spoken.add(item.id); if (spoken.size > 100) spoken.delete(spoken.values().next().value!);
      queue = [...queue, item].slice(-3); void speakNext();
    }
  });
  return () => { off(); offVoice(); stop(); };
}
