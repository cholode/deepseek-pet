import { speechChunks, type VoiceResponse } from '../../shared/voice';
import type { SpeechLanguage, SpeechSegment } from '../../shared/speech-language';

// 播放保持顺序，后台提前合成下一句；每次只合成一句，兼容不能并发的本机引擎。
export class VoicePlayer {
  private generation = 0; private audio?: HTMLAudioElement; private url?: string; private finish?: () => void;
  private finishLoadingVoices?: () => void;
  private playbackId?: string;
  stop() {
    this.generation++; this.finishLoadingVoices?.(); window.speechSynthesis?.cancel(); this.audio?.pause(); this.finish?.(); this.finish = undefined; this.audio = undefined;
    if (this.url) URL.revokeObjectURL(this.url); this.url = undefined;
    const playbackId = this.playbackId; this.playbackId = undefined;
    if (playbackId) void window.pet.voice({ type: 'cancel', playbackOnly: true, playbackId }).catch(() => {});
  }
  private availableVoices(): Promise<SpeechSynthesisVoice[]> {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return Promise.resolve([]);
    const local = () => synthesis.getVoices().filter(voice => voice.localService);
    const ready = local(); if (ready.length) return Promise.resolve(ready);
    // Chromium 首次调用时列表可能为空，等待系统返回；停止/切页必须同步解除等待。
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); synthesis.removeEventListener('voiceschanged', changed); if (this.finishLoadingVoices === finish) this.finishLoadingVoices = undefined; resolve(local()); };
      const changed = () => { if (local().length) finish(); };
      const timer = setTimeout(finish, 5000);
      this.finishLoadingVoices = finish; synthesis.addEventListener('voiceschanged', changed); changed();
    });
  }
  async speak(text: string, test = false, segments?: SpeechSegment[], language?: SpeechLanguage) {
    if (this.playbackId) this.stop();
    const current = this.generation;
    const playbackId = crypto.randomUUID(); this.playbackId = playbackId;
    const chunks = (segments ?? [{ text, language }]).flatMap(part => speechChunks(part.text).map(chunk => ({ text: chunk, language: part.language })));
    const pending = new Map<number, Promise<VoiceResponse>>();
    let next = 0; let tail: Promise<VoiceResponse> = Promise.resolve({ ok: true });
    const prepare = (index: number) => {
      // 最多持有当前句和下一句，避免长回复一次合成全部音频。拒绝也转成结果，防止未播放的预取产生未处理异常。
      while (next < Math.min(chunks.length, index + 2)) {
        const chunk = chunks[next];
        const response = tail.then(previous => current !== this.generation || !previous.ok ? previous : window.pet.voice({ type: 'speak', ...chunk, test, playbackId }))
          .catch((): VoiceResponse => ({ ok: false, message: '语音请求失败，请检查语音服务' }));
        pending.set(next++, response); tail = response;
      }
    };
    try {
      for (let index = 0; index < chunks.length; index++) {
        if (current !== this.generation) return;
        prepare(index);
        const response = await pending.get(index)!; pending.delete(index);
        if (current !== this.generation) return;
        if (!response.ok) throw new Error(response.message ?? '朗读失败');
        const voices = response.system ? await this.availableVoices() : [];
        if (current !== this.generation) return;
        await this.play(chunks[index].text, response, voices);
      }
    } catch (error) {
      if (current !== this.generation) return;
      this.stop(); throw error;
    } finally { pending.clear(); if (this.playbackId === playbackId) this.playbackId = undefined; }
  }
  private play(chunk: string, response: VoiceResponse, voices: SpeechSynthesisVoice[]) {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); this.finish = undefined; this.audio?.pause(); this.audio = undefined; if (this.url) URL.revokeObjectURL(this.url); this.url = undefined; if (error) reject(error); else resolve(); };
        this.finish = () => done(); const timer = setTimeout(() => { window.speechSynthesis?.cancel(); done(new Error('朗读超时，请重试或调整语音服务')); }, 180000);
        if (response.system) {
          const config = response.system; const synthesis = window.speechSynthesis;
          const candidates = config.mode === 'language' ? voices.filter(v => /^zh(?:-|_)/i.test(v.lang) && /Microsoft/i.test(v.name)) : voices;
          const voice = config.systemVoice ? candidates.find(v => v.voiceURI === config.systemVoice) : candidates.find(v => /^zh/.test(v.lang)) ?? candidates[0];
          if (!voice) { done(new Error('没有可用的本地声音，请在 Windows 语音设置中安装，或选择本地 TTS 服务')); return; }
          const utterance = new SpeechSynthesisUtterance(chunk); utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = config.rate; utterance.volume = config.volume;
          utterance.onend = () => done(); utterance.onerror = () => done(new Error('系统语音朗读失败，请检查声音设置')); synthesis.speak(utterance);
        } else if (response.audio) {
          this.url = URL.createObjectURL(new Blob([response.audio], { type: 'audio/wav' })); const audio = new Audio(this.url); this.audio = audio;
          audio.volume = response.volume ?? 0.8;
          audio.onended = () => done(); audio.onerror = () => done(new Error('音频播放失败，请检查 TTS 服务返回的声音'));
          void audio.play().catch(() => done(new Error('音频播放被阻止，请在对话设置中试听')));
        } else done();
    });
  }
}
