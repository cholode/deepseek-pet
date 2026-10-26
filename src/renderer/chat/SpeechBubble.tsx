import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SpeechBubbleState } from '../../shared/pet-chat';
import './chat.css';

export function SpeechBubble() {
  const [state, setState] = useState<SpeechBubbleState | null>(null);
  const [size, setSize] = useState({ width: 180, height: 78 });
  const box = useRef<HTMLDivElement>(null); const content = useRef<HTMLDivElement>(null);
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
    const width = Math.min(320, Math.max(120, Math.ceil(Math.max(...text.split('\n').map(line => context.measureText(line).width))) + 34));
    box.current.style.width = `${width}px`;
    const height = Math.ceil(box.current.getBoundingClientRect().height);
    // 四周留 16px 绘制尖角，头部锚点变动不触发文字重新测量或窗口尺寸震荡。
    const next = { width: width + 32, height: height + 32 }; setSize(next);
    void window.pet.sizeSpeechBubble(next).catch(() => {});
    if (content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [text, streaming]);
  if (!state) return null;
  const { width: w, height: h } = size; const { side, offset: p } = state.tail ?? { side: 'bottom', offset: w / 2 };
  const path = side === 'bottom' ? `M ${p - 11} ${h - 17} L ${p} ${h - 4} L ${p + 11} ${h - 17}`
    : side === 'left' ? `M 17 ${p - 11} L 4 ${p} L 17 ${p + 11}` : `M ${w - 17} ${p - 11} L ${w - 4} ${p} L ${w - 17} ${p + 11}`;
  return <div className="speech-shell" style={{ width: w, height: h }} data-side={side}>
    <div className={`speech-bubble ${state.streaming ? 'streaming' : ''}`} ref={box} role="status"><div className="speech-content" ref={content}>{state.text}</div></div>
    <svg className="speech-tail" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={path}/></svg>
  </div>;
}
