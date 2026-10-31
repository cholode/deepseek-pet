import type { CompanionPresentation } from '../../shared/companion';
import type { PetRuntime } from './PetRuntime';
import { VoicePlayer } from '../voice/player';

// 同一个回复持续追加句子，完成通知只关闭输入队列，绝不重新朗读全文。
export function mountCompanionPresentation(runtime: PetRuntime, ready = () => true) {
  const spoken = new Set<string>(); const player = new VoicePlayer();
  let active: { key: string; item: CompanionPresentation; stream: ReturnType<VoicePlayer['begin']> } | undefined;
  const finished = (item: CompanionPresentation) => { void window.pet.voice({ type: 'playback-progress', presentationId: item.id, speechRevision: item.speechRevision, finished: true }).catch(() => {}); };
  const stop = () => { const item = active?.item; active = undefined; player.stop(); if (item) finished(item); };
  const offVoice = window.pet.onVoice(event => { if (event.type !== 'state') stop(); });
  const off = window.pet.onPresentation(item => {
    if (!item) { stop(); return; }
    if (item.phase !== 'streaming' && item.groupId && ready()) void runtime.port('ai').submit({ protocolVersion: 1, type: 'play_group', commandId: item.id, groupId: item.groupId, expiresAtUnixMs: Date.now() + 3000 });
    if (item.phase === 'action' || !item.speech.enabled) return;
    const key = item.id + ':' + (item.speechRevision ?? 0);
    if (active?.key !== key) {
      if (spoken.has(key)) return;
      stop(); spoken.add(key); if (spoken.size > 100) spoken.delete(spoken.values().next().value!);
      const stream = player.begin(chunk => { void window.pet.voice({ type: 'playback-progress', presentationId: item.id, speechRevision: item.speechRevision, chunk }).catch(() => {}); });
      const session = { key, item, stream }; active = session;
      void stream.done.catch(error => {
        if (active === session) void window.pet.voice({ type: 'report-error', message: error instanceof Error ? error.message : '朗读失败' });
      }).finally(() => { finished(session.item); if (active === session) active = undefined; });
    }
    if (active?.key === key) { active.item = item; active.stream.update(item.text, item.speechSegments ?? (item.phase === 'streaming' ? [] : undefined), item.phase !== 'streaming'); }
  });
  return () => { off(); offVoice(); stop(); };
}
