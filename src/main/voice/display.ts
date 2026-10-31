import type { CompanionPresentation, CompanionView } from '../../shared/companion';
import { speechPlan, type VoiceRequest } from '../../shared/voice';

type Progress = Extract<VoiceRequest, { type: 'playback-progress' }>;
interface Pending { value: CompanionPresentation; text: string; open: boolean; firstFrame: boolean; timer: ReturnType<typeof setTimeout>; release?: ReturnType<typeof setTimeout> }
/** 首句声音实际开始时打开文字闸门；此后模型文字流与有序语音播放互不等待。 */
export class SpeechDisplay {
  private pending = new Map<string, Pending>();
  private latest?: string;
  constructor(private visual: (value: CompanionPresentation | null) => void, private refresh: () => void) {}
  present(value: CompanionPresentation | null) {
    if (!value) { this.flush(); this.latest = undefined; this.visual(null); return; }
    if (value.phase === 'action') return;
    this.latest = value.id;
    let item = this.pending.get(value.id);
    if (item && (item.value.speechRevision ?? 0) !== (value.speechRevision ?? 0)) { this.clear(item); this.pending.delete(value.id); item = undefined; }
    if (!value.speech.enabled || (value.phase !== 'streaming' && !speechPlan(value.text, value.speechSegments).length)) {
      if (item) this.clear(item); this.pending.delete(value.id); this.visual(value); this.refresh(); return;
    }
    if (!item) {
      item = { value, text: '', open: false, firstFrame: false, timer: setTimeout(() => this.progress({ type: 'playback-progress', presentationId: value.id, speechRevision: value.speechRevision, finished: true }), 240000) };
      this.pending.set(value.id, item);
    }
    item.value = value;
    if (!item.firstFrame) item.text = item.open ? value.text : value.phase === 'streaming' ? '正在组织回复…' : '正在准备语音…';
    this.show(item);
  }
  private show(item: Pending) {
    if (this.latest === item.value.id) this.visual({ ...item.value, text: item.text, phase: item.open && !item.firstFrame ? item.value.phase : 'streaming', speechSegments: undefined });
  }
  private clear(item: Pending) { clearTimeout(item.timer); clearTimeout(item.release); }
  progress(request: Progress) {
    const item = this.pending.get(request.presentationId);
    if (!item || (request.speechRevision ?? 0) !== (item.value.speechRevision ?? 0)) return;
    if (request.finished) {
      this.clear(item); item.open = true; item.firstFrame = false; item.text = item.value.text; this.show(item);
      // 失败/停止时也打开文字闸门；模型还在流式生成则保留状态，让后续文字继续到达。
      if (item.value.phase !== 'streaming') this.pending.delete(request.presentationId);
      this.refresh(); return;
    }
    if (request.chunk !== 0 || item.open) return;
    const first = speechPlan(item.value.text, item.value.speechSegments)[0]; if (!first) return;
    item.open = true; item.firstFrame = true; item.text = item.value.text.slice(0, first.displayEnd);
    this.show(item); this.refresh();
    // 给首句一个显示帧；之后立即释放已缓冲正文，未来增量直接显示，不等第二句音频。
    item.release = setTimeout(() => { item.firstFrame = false; item.text = item.value.text; this.show(item); this.refresh(); }, 16);
  }
  view(view: CompanionView): CompanionView {
    if (!this.pending.size) return view;
    return { ...view, data: { ...view.data, events: view.data.events.map(event => {
      const item = this.pending.get(event.id); return item ? { ...event, text: item.text, speechSegments: undefined } : event;
    }) } };
  }
  flush() {
    const latest = this.latest && this.pending.get(this.latest);
    for (const item of this.pending.values()) this.clear(item);
    this.pending.clear(); if (latest) this.visual(latest.value); this.refresh();
  }
}
