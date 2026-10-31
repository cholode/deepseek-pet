import { speechPlaybackPlan, usesGptSovits, type SpeechChunk, type VoiceResponse } from '../../shared/voice';
import type { SpeechLanguage, SpeechSegment } from '../../shared/speech-language';

// 模型句子持续入队；合成并发、播放有序，文字显示由首句开始事件单独解锁。
export class VoicePlayer {
  private generation = 0; private audio?: HTMLAudioElement; private url?: string; private finish?: () => void;
  private finishLoadingVoices?: () => void;
  private playbackId?: string; private wake?: () => void;
  stop() {
    this.generation++; this.wake?.(); this.finishLoadingVoices?.(); window.speechSynthesis?.cancel(); this.audio?.pause(); this.finish?.(); this.finish = undefined; this.audio = undefined;
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
  begin(onStart?: (index: number) => void, test = false) {
    if (this.playbackId) this.stop();
    const current = this.generation, playbackId = crypto.randomUUID(); this.playbackId = playbackId;
    let snapshot: { text: string; segments?: SpeechSegment[]; language?: SpeechLanguage } | undefined;
    let closed = false, chunks: SpeechChunk[] = [], next = 0, playing = 0, active = 0, initialized = false;
    let settings: VoiceResponse = { ok: false }, failed = false;
    const pending = new Map<number, Promise<VoiceResponse>>();
    let resume: (() => void) | undefined;
    const wake = () => { const resolve = resume; resume = undefined; resolve?.(); };
    this.wake = wake;
    const wait = () => new Promise<void>(resolve => { resume = resolve; });
    const live = () => current === this.generation;
    const updatePlan = () => {
      if (!snapshot || !initialized) return;
      const plan = speechPlaybackPlan(snapshot.text, settings.state?.config.tts, snapshot.segments, snapshot.language);
      // 已合成的前缀不可重写；标签修复或工具换轮应使用新播放批次，不能偷偷重读。
      if (chunks.some((chunk, index) => !plan[index] || chunk.text !== plan[index].text || chunk.language !== plan[index].language || chunk.emotion !== plan[index].emotion)) {
        failed = true; throw new Error('流式语音正文发生变化，已停止朗读；完整文字继续显示');
      }
      chunks = plan;
    };
    const pump = () => {
      if (!live() || !initialized || failed) return;
      const config = settings.state?.config.tts;
      const concurrency = config ? usesGptSovits(config) ? config.gptSovits.workers : config.synthesisConcurrency : 2;
      // 限制的是同时计算和持有的音频数；所有后续文字照常入队，不被语音背压阻塞。
      while (active < concurrency && next < chunks.length && next < playing + Math.max(2, concurrency * 2)) {
        const index = next++, chunk = chunks[index]; active++;
        const task = window.pet.voice({ type: 'speak', text: chunk.text, language: chunk.language, emotion: chunk.emotion, test, playbackId, chunk: index })
          .catch((): VoiceResponse => ({ ok: false, message: '语音请求失败，请检查语音服务' }))
          .then(response => { if (!response.ok) failed = true; return response; })
          .finally(() => { active--; pump(); wake(); });
        pending.set(index, task);
      }
    };
    const done = (async () => {
      try {
        settings = await window.pet.voice({ type: 'state' }).catch((): VoiceResponse => ({ ok: false }));
        if (!live()) return;
        initialized = true; updatePlan(); pump();
        while (live()) {
          if (playing >= chunks.length) { if (closed) break; await wait(); continue; }
          pump();
          const task = pending.get(playing);
          if (!task) { if (failed) throw new Error('语音合成失败，后续朗读已停止'); await wait(); continue; }
          const response = await task;
          if (!live()) return;
          if (!response.ok) throw new Error(response.message ?? '朗读失败');
          const voices = response.system ? await this.availableVoices() : [];
          if (!live()) return;
          const index = playing;
          await this.play(chunks[index].text, response, voices, () => { if (live()) onStart?.(index); });
          pending.delete(index); playing++; pump();
        }
      } catch (error) { if (live()) { this.stop(); throw error; } }
      finally { pending.clear(); if (this.playbackId === playbackId) this.playbackId = undefined; if (this.wake === wake) this.wake = undefined; }
    })();
    return {
      done,
      update: (text: string, segments?: SpeechSegment[], complete = false, language?: SpeechLanguage) => {
        if (!live() || closed || failed) return;
        snapshot = { text, segments, language }; closed = complete;
        try { updatePlan(); pump(); } catch (error) { this.stop(); void window.pet.voice({ type: 'report-error', message: error instanceof Error ? error.message : '流式朗读失败' }); }
        wake();
      }
    };
  }
  async speak(text: string, test = false, segments?: SpeechSegment[], language?: SpeechLanguage, onStart?: (index: number) => void) {
    const stream = this.begin(onStart, test); stream.update(text, segments, true, language); await stream.done;
  }
  private play(chunk: string, response: VoiceResponse, voices: SpeechSynthesisVoice[], onStart: () => void) {
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
          utterance.onstart = () => { if (!settled) onStart(); }; utterance.onend = () => done(); utterance.onerror = () => done(new Error('系统语音朗读失败，请检查声音设置')); synthesis.speak(utterance);
        } else if (response.audio) {
          this.url = URL.createObjectURL(new Blob([response.audio], { type: 'audio/wav' })); const audio = new Audio(this.url); this.audio = audio;
          audio.volume = response.volume ?? 0.8;
          let started = false; audio.onplaying = () => { if (!settled && !started) { started = true; onStart(); } };
          audio.onended = () => done(); audio.onerror = () => done(new Error('音频播放失败，请检查 TTS 服务返回的声音'));
          void audio.play().catch(() => done(new Error('音频播放被阻止，请在对话设置中试听')));
        } else done();
    });
  }
}
