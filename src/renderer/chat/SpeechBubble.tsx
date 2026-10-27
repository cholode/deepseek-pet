import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SpeechBubbleState } from '../../shared/pet-chat';
import { MarkdownContent } from './MarkdownContent';
import { useMessageScroll } from './useMessageScroll';
import './chat.css';

export function SpeechBubble() {
  const [state, setState] = useState<SpeechBubbleState | null>(null);
  const [size, setSize] = useState({ width: 180, height: 78 });
  const box = useRef<HTMLDivElement>(null);
  const scroll = useMessageScroll(state?.text, state?.id, !state?.streaming);
  useEffect(() => {
    let live = true;
    const off = window.pet.onSpeechBubble(value => { if (live) setState(value); });
    void window.pet.speechBubbleState().then(value => { if (live) setState(value); });
    return () => { live = false; off(); };
  }, []);
  const text = state?.text; const streaming = state?.streaming;
  useLayoutEffect(() => {
    if (!box.current || text === undefined) return;
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '14px "Microsoft YaHei", sans-serif';
    const width = Math.min(360, Math.max(120, Math.ceil(text.split('\n').reduce((max, line) => Math.max(max, context.measureText(line).width), 0)) + 34));
    box.current.style.width = `${width}px`;
    const measure = () => {
      if (!box.current) return;
      const height = Math.ceil(box.current.getBoundingClientRect().height);
      // 四周留 16px 绘制尖角；内容超长时限制气泡高度，由内部滚动区承载。
      const next = { width: width + 32, height: height + 32 };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
      void window.pet.sizeSpeechBubble(next).catch(() => {});
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(box.current);
    return () => observer.disconnect();
  }, [text, streaming, scroll.overflow]);
  if (!state) return null;
  const { width: w, height: h } = size; const { side, offset: p } = state.tail ?? { side: 'bottom', offset: w / 2 };
  const path = side === 'bottom' ? `M ${p - 11} ${h - 17} L ${p} ${h - 4} L ${p + 11} ${h - 17}`
    : side === 'left' ? `M 17 ${p - 11} L 4 ${p} L 17 ${p + 11}` : `M ${w - 17} ${p - 11} L ${w - 4} ${p} L ${w - 17} ${p + 11}`;
  return <div className="speech-shell" style={{ width: w, height: h }} data-side={side} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); void window.pet.dismissSpeechBubble(); } }}>
    <div className={`speech-bubble ${state.streaming ? 'streaming' : ''}`} ref={box}>
      <div className="speech-content" ref={scroll.ref} onScroll={scroll.onScroll} tabIndex={0} role="region" aria-label="大肥鱼回复内容"><MarkdownContent text={state.text}/></div>
      {scroll.overflow && <div className="speech-controls"><span>滚动阅读</span><button onClick={scroll.toStart}>开头</button><button onClick={scroll.toLatest} disabled={scroll.atBottom}>最新</button><button aria-label="关闭回复" title="关闭回复（Esc）" onClick={() => void window.pet.dismissSpeechBubble()}>×</button></div>}
    </div>
    <svg className="speech-tail" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={path}/></svg>
  </div>;
}
