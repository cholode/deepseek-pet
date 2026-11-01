import { useEffect, useRef, useState } from 'react';
import type { QuickChatState, QuickChatTab } from '../../shared/pet-chat';
import { PetStatusCard } from './PetStatusCard';
import { VoiceInput } from '../voice/VoiceInput';
import { ExpressionButton, ExpressionPicker, StickerDraft } from './ExpressionPicker';
import { useChatDraft } from './useChatDraft';
import './chat.css';

export function QuickChat() {
  const [state, setState] = useState<QuickChatState>({ name: '大肥鱼', ready: false, busy: false, reply: '', streaming: false, tab: 'chat', status: null });
  const draft = useChatDraft(); const { text, setText, sticker, setSticker, picker, setPicker } = draft;
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const composing = useRef(false); const sending = useRef(false);
  useEffect(() => {
    let live = true;
    const off = window.pet.onQuickChat(value => { if (live) setState(value); });
    void window.pet.quickChat({ type: 'state' }).then(value => { if (live) setState(value.state); }).catch(e => setError(String(e)));
    return () => { live = false; off(); };
  }, []);
  useEffect(() => { void window.pet.quickChat({ type: 'hold', value: Boolean(text.trim()) || Boolean(sticker) || picker || pending || recording }).catch(() => {}); }, [text, sticker, picker, pending, recording]);
  useEffect(() => { void window.pet.quickChat({ type: 'composer', picker, attachment: Boolean(sticker) }).catch(() => {}); }, [picker, sticker]);
  function send(voiceText?: string): boolean {
    const value = (voiceText ?? text).trim(); const fromVoice = voiceText !== undefined;
    const attachment = fromVoice ? undefined : sticker;
    if ((!value && !attachment) || value.length > 4000 || (!fromVoice && recording) || !state.ready || state.busy || sending.current) return false;
    sending.current = true; setPending(true); setError(''); setPicker(false); if (!fromVoice) { setText(''); setSticker(undefined); }
    // 语音单独提交；未发送的键盘草稿不能随语音一起交给模型。
    const failed = (message: string) => { setError(fromVoice ? `${message}。识别结果：${value}` : message); if (!fromVoice) { setText(current => current || value); setSticker(current => current ?? attachment); } };
    void (async () => {
      try {
        const response = await window.pet.quickChat({ type: 'send', text: value, stickerId: attachment?.id }); setState(response.state);
        if (!response.ok) failed(response.message ?? '发送失败');
      } catch (e) { failed(String(e)); }
      finally { sending.current = false; setPending(false); }
    })();
    return true;
  }
  const dismiss = () => void window.pet.quickChat({ type: 'dismiss' }).catch(e => setError(String(e)));
  const selectTab = (tab: QuickChatTab) => void window.pet.quickChat({ type: 'tab', tab }).then(r => setState(r.state)).catch(e => setError(String(e)));
  const busy = state.busy || pending; const problem = error || state.error;
  return <section className="quick-shell" role="dialog" aria-label="大肥鱼快捷菜单" onKeyDown={e => { if (e.key === 'Escape' && !composing.current) { e.preventDefault(); if (picker) setPicker(false); else dismiss(); } }}>
    {/* 两页始终保留挂载，切换状态时不丢失草稿、输入光标或进行中的发送请求。 */}
    <div id="quick-chat-panel" role="tabpanel" aria-labelledby="quick-chat-tab" hidden={state.tab !== 'chat'} className="quick-composer">
    {picker && <ExpressionPicker onEmoji={draft.emoji} onSticker={item => { setSticker(item); setError(''); }} close={() => setPicker(false)}/>}
    {sticker && <StickerDraft item={sticker} error={problem} remove={() => { setSticker(undefined); setError(''); }}/>}
    <div className={`quick-chat ${problem ? 'has-error' : ''} ${voiceStatus ? 'has-voice-status' : ''}`} title={problem || 'Enter 发送 · Shift + Enter 换行 · Esc 收起'}>
    <textarea ref={draft.input} aria-label="和大肥鱼聊天" rows={1} value={text} maxLength={4000} disabled={!state.ready} placeholder={state.ready ? busy ? '正在回复…可以先写下一句' : '和大肥鱼说点什么…' : '双击大肥鱼，在小屋配置模型'}
      onChange={e => setText(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); void send(); } }}/>
    <ExpressionButton open={picker} disabled={!state.ready || recording} onClick={() => setPicker(value => !value)}/>
    {state.tab === 'chat' && <VoiceInput compact purpose="chat" disabled={!state.ready || busy} onBusy={setRecording} onStatus={setVoiceStatus} onText={send}/>}
    <button className="quick-send" aria-label={busy ? '停止' : '发送'} title={busy ? '停止生成' : '发送'} disabled={!busy && (recording || !state.ready || (!text.trim() && !sticker))}
      onClick={() => busy ? void window.pet.quickChat({ type: 'cancel' }).then(r => setState(r.state)).catch(e => setError(String(e))) : void send()}>
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">{busy ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/> : <path d="m5 12 7-7 7 7M12 5v15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
    </button>
    {problem && <span className="quick-error" role="status">{problem}</span>}
    {voiceStatus && <div className="quick-voice-status" role="status" title={voiceStatus}>{voiceStatus}</div>}
    </div>
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
