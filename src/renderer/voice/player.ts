import { speechChunks } from '../../shared/voice';

// 同一窗口串行播放；停止时同时撤销合成请求、系统朗读及 Blob 音频。
export class VoicePlayer {
  private generation = 0; private audio?: HTMLAudioElement; private url?: string; private finish?: () => void;
  stop() {
    this.generation++; window.speechSynthesis?.cancel(); this.audio?.pause(); this.finish?.(); this.finish = undefined; this.audio = undefined;
    if (this.url) URL.revokeObjectURL(this.url); this.url = undefined;
    void window.pet.voice({ type: 'cancel', playbackOnly: true }).catch(() => {});
  }
  async speak(text: string, test = false) {
    const current = this.generation;
    for (const chunk of speechChunks(text)) {
      if (current !== this.generation) return;
      const response = await window.pet.voice({ type: 'speak', text: chunk, test });
      if (current !== this.generation) return;
      if (!response.ok) throw new Error(response.message ?? '朗读失败');
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); this.finish = undefined; this.audio?.pause(); this.audio = undefined; if (this.url) URL.revokeObjectURL(this.url); this.url = undefined; if (error) reject(error); else resolve(); };
        this.finish = () => done(); const timer = setTimeout(() => { window.speechSynthesis?.cancel(); done(new Error('朗读超时，请重试或调整语音服务')); }, 180000);
        if (response.system) {
          const config = response.system; const synthesis = window.speechSynthesis;
          const voices = synthesis?.getVoices().filter(v => v.localService) ?? [];
          const voice = config.systemVoice ? voices.find(v => v.voiceURI === config.systemVoice) : voices.find(v => /^zh/.test(v.lang)) ?? voices[0];
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
}
