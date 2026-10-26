import { useEffect, useRef, useState } from 'react';
import type { QuickChatState, QuickChatTab } from '../../shared/pet-chat';
import { PetStatusCard } from './PetStatusCard';
import './chat.css';

export function QuickChat() {
  const [state, setState] = useState<QuickChatState>({ name: '大肥鱼', ready: false, busy: false, reply: '', streaming: false, tab: 'chat', status: null });
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
  const selectTab = (tab: QuickChatTab) => void window.pet.quickChat({ type: 'tab', tab }).then(r => setState(r.state)).catch(e => setError(String(e)));
  const busy = state.busy || pending; const problem = error || state.error;
  return <section className="quick-shell" role="dialog" aria-label="大肥鱼快捷菜单" onKeyDown={e => { if (e.key === 'Escape' && !composing.current) { e.preventDefault(); dismiss(); } }}>
    {/* 两页始终保留挂载，切换状态时不丢失草稿、输入光标或进行中的发送请求。 */}
    <div id="quick-chat-panel" role="tabpanel" aria-labelledby="quick-chat-tab" hidden={state.tab !== 'chat'} className={`quick-chat ${problem ? 'has-error' : ''}`} title={problem || 'Enter 发送 · Shift + Enter 换行 · Esc 收起'}>
    <textarea aria-label="和大肥鱼聊天" rows={1} value={text} maxLength={4000} disabled={!state.ready} placeholder={state.ready ? busy ? '正在回复…可以先写下一句' : '和大肥鱼说点什么…' : '双击大肥鱼，在小屋配置模型'}
      onChange={e => setText(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); void send(); } }}/>
    <button className="quick-send" aria-label={busy ? '停止' : '发送'} title={busy ? '停止生成' : '发送'} disabled={!busy && (!state.ready || !text.trim())}
      onClick={() => busy ? void window.pet.quickChat({ type: 'cancel' }).then(r => setState(r.state)).catch(e => setError(String(e))) : void send()}>
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">{busy ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/> : <path d="m5 12 7-7 7 7M12 5v15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
    </button>
    {problem && <span className="quick-error" role="status">{problem}</span>}
    </div>
    <div id="quick-status-panel" role="tabpanel" aria-labelledby="quick-status-tab" hidden={state.tab !== 'status'}>
      <PetStatusCard state={state}/>
    </div>
    <nav className="quick-menu" role="tablist" aria-label="大肥鱼快捷功能">
      {(['chat', 'status'] as const).map(tab => <button key={tab} id={`quick-${tab}-tab`} type="button" role="tab" aria-controls={`quick-${tab}-panel`} aria-selected={state.tab === tab} tabIndex={state.tab === tab ? 0 : -1}
        onClick={() => selectTab(tab)} onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); const next = e.key === 'Home' ? 'chat' : e.key === 'End' ? 'status' : tab === 'chat' ? 'status' : 'chat';
          selectTab(next); document.getElementById(`quick-${next}-tab`)?.focus();
        }}>
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {tab === 'chat' ? <path d="M5 3.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4.5 3v-3H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/> : <path d="M3 10h3l2-5 4 10 2-5h3"/>}
        </svg>{tab === 'chat' ? '聊天' : '状态'}
      </button>)}
    </nav>
  </section>;
}
