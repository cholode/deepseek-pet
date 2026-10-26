import type { CompanionPresentation } from '../../shared/companion';
import type { PetRuntime } from './PetRuntime';

// 原生气泡独立排版；此处只负责语音和角色动作，增量文字不能反复触发朗读。
export function mountCompanionPresentation(runtime: PetRuntime) {
  const spoken = new Set<string>();
  let queue: CompanionPresentation[] = []; let speaking = false; let epoch = 0;
  const stop = () => { epoch++; queue = []; speaking = false; window.speechSynthesis?.cancel(); };
  const speakNext = () => {
    if (speaking || !queue.length || !window.speechSynthesis) return;
    const item = queue.shift()!; const current = epoch;
    const voices = window.speechSynthesis.getVoices().filter(v => v.localService);
    const voice = voices.find(v => v.voiceURI === item.speech.voice) ?? voices.find(v => /^zh/.test(v.lang));
    // 未安装本地中文语音时保留文字，不悄悄使用远程语音服务。
    if (!voice) { speakNext(); return; }
    const utterance = new SpeechSynthesisUtterance(item.text); utterance.voice = voice; utterance.lang = voice.lang;
    utterance.rate = item.speech.rate; utterance.volume = item.speech.volume; speaking = true;
    const done = () => { if (epoch !== current) return; speaking = false; speakNext(); };
    utterance.onend = done; utterance.onerror = done; window.speechSynthesis.speak(utterance);
  };
  const off = window.pet.onPresentation(item => {
    if (!item) { stop(); return; }
    if (item.phase === 'streaming') return;
    if (item.groupId) void runtime.port('ai').submit({ protocolVersion: 1, type: 'play_group', commandId: item.id, groupId: item.groupId, expiresAtUnixMs: Date.now() + 3000 });
    if (item.phase !== 'action' && item.speech.enabled && !spoken.has(item.id)) {
      spoken.add(item.id); if (spoken.size > 100) spoken.delete(spoken.values().next().value!);
      queue = [...queue, item].slice(-3); speakNext();
    }
  });
  return () => { off(); stop(); };
}
