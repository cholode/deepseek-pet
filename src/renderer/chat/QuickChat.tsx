import { useEffect, useRef, useState } from 'react';
import type { QuickChatState } from '../../shared/pet-chat';
import './chat.css';

export function QuickChat() {
  const [state, setState] = useState<QuickChatState>({ name: '大肥鱼', ready: false, busy: false, reply: '', streaming: false });
  const [text, setText] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const composing = useRef(false); const sending = useRef(false);
  useEffect(() => {
    let live = true;
    const off = window.pet.onQuickChat(value => { if (live) setState(value); });
    void window.pet.quickChat({ type: 'state' }).then(value => { if (live) setState(value.state); }).catch(e => setError(String(e)));
    return () => { live = false; off(); };
  }, []);
  useEffect(() => { void window.pet.quickChat({ type: 'hold', value: Boolean(text.trim()) || pending }).catch(() => {}); }, [text, pending]);
  async function send() {
    const value = text.trim(); if (!value || !state.ready || state.busy || sending.current) return;
    sending.current = true; setPending(true); setError(''); setText('');
    try {
      const response = await window.pet.quickChat({ type: 'send', text: value }); setState(response.state);
      if (!response.ok) { setError(response.message ?? '发送失败'); setText(current => current || value); }
    } catch (e) { setError(String(e)); setText(current => current || value); }
    finally { sending.current = false; setPending(false); }
  }
  const dismiss = () => void window.pet.quickChat({ type: 'dismiss' }).catch(e => setError(String(e)));
  const busy = state.busy || pending; const problem = error || state.error;
  return <section className={`quick-chat ${problem ? 'has-error' : ''}`} role="dialog" aria-label="大肥鱼聊天框" title={problem || 'Enter 发送 · Shift + Enter 换行 · Esc 收起'} onKeyDown={e => { if (e.key === 'Escape' && !composing.current) { e.preventDefault(); dismiss(); } }}>
    <textarea aria-label="和大肥鱼聊天" rows={1} value={text} maxLength={4000} disabled={!state.ready} placeholder={state.ready ? busy ? '正在回复…可以先写下一句' : '和大肥鱼说点什么…' : '双击大肥鱼，在小屋配置模型'}
      onChange={e => setText(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); void send(); } }}/>
    <button className="quick-send" aria-label={busy ? '停止' : '发送'} title={busy ? '停止生成' : '发送'} disabled={!busy && (!state.ready || !text.trim())}
      onClick={() => busy ? void window.pet.quickChat({ type: 'cancel' }).then(r => setState(r.state)).catch(e => setError(String(e))) : void send()}>
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">{busy ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/> : <path d="m5 12 7-7 7 7M12 5v15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
    </button>
    {problem && <span className="quick-error" role="status">{problem}</span>}
  </section>;
}
