import { useEffect, useRef, useState } from 'react';
import { companionDefaults, emotionLabels, emotionNames, type CompanionConfig, type CompanionRequest, type CompanionView, type CompanionPresentation } from '../../shared/companion';
import { CompanionSettings } from './CompanionSettings';
import { ConversationSettings } from './ConversationSettings';
import { VoiceInput } from '../voice/VoiceInput';
import { DiaryPanel } from './DiaryPanel';
import { GrowthPanel } from './GrowthPanel';
import { StudioPanel } from './StudioPanel';
import { MarkdownContent } from '../chat/MarkdownContent';
import { useMessageScroll } from '../chat/useMessageScroll';
import './companion.css';

// UI 仅发送受限请求；所有模型调用、记忆写入和渠道权限在主进程服务中执行。
export function CompanionPanel() {
  const [state, setState] = useState<CompanionView>(); const [tab, setTab] = useState('chat');
  const [stream, setStream] = useState<CompanionPresentation | null>(null);
  const [draft, setDraft] = useState<CompanionConfig>(structuredClone(companionDefaults));
  const [secrets, setSecrets] = useState<Partial<Record<'model' | 'qq' | 'mcp', string>>>({});
  const [recording, setRecording] = useState(false);
  const sending = useRef(false);
  const [text, setText] = useState(''); const [note, setNote] = useState(''); const [pending, setPending] = useState(false);
  const [memory, setMemory] = useState(''); const [factKey, setFactKey] = useState(''); const [scope, setScope] = useState<'private' | 'public'>('private');
  const [kind, setKind] = useState<'episode' | 'fact' | 'preference'>('fact'); const [query, setQuery] = useState('');
  const [goal, setGoal] = useState(''); const [due, setDue] = useState('');
  const scroll = useMessageScroll(`${state?.data.events.at(-1)?.id}:${state?.data.events.at(-1)?.text}:${stream?.text ?? ''}`, `${tab}:${Boolean(state)}`);
  useEffect(() => {
    let live = true;
    void window.pet.companion({ type: 'state' }).then(r => { if (live) { setState(r.state); setDraft(r.state.data.config); } }).catch(e => { if (live) setNote(String(e)); });
    const off = window.pet.onCompanion(s => { if (live) setState(s); });
    const offStream = window.pet.onPresentation(s => { if (live && s?.phase !== 'action') setStream(s?.phase === 'streaming' ? s : null); });
    // 只刷新本地状态，让没有新事件时的心情衰减也能显示；不触发模型请求。
    const timer = setInterval(() => { void window.pet.companion({ type: 'state' }).then(r => { if (live) setState(r.state); }).catch(() => {}); }, 30000);
    return () => { live = false; clearInterval(timer); off(); offStream(); };
  }, []);
  async function request(value: CompanionRequest) {
    setPending(true); setNote('');
    try { const response = await window.pet.companion(value); setState(response.state); if (!response.ok) setNote(response.message ?? '操作失败'); return response; }
    catch (e) { setNote(String(e)); return undefined; }
    finally { setPending(false); }
  }
  async function save(discover = false) {
    const result = await request({ type: 'configure', config: draft, secrets });
    if (result?.ok) { setSecrets({}); setDraft(result.state.data.config); setNote('陪伴设置已保存'); if (discover) await request({ type: 'discover-tools' }); }
  }
  function send(voiceText?: string): boolean {
    const value = (voiceText ?? text).trim(); const fromVoice = voiceText !== undefined;
    if (!value || value.length > 4000 || (!fromVoice && recording) || !state?.ready || state.busy || pending || sending.current) return false;
    sending.current = true; if (!fromVoice) setText('');
    // 直接复用正常聊天通道，语音不清空或附带已有草稿。
    void request({ type: 'chat', text: value }).then(result => {
      if (!result?.ok) {
        if (fromVoice) setNote(`${result?.message ?? '发送失败'}。识别结果：${value}`);
        else setText(current => current || value);
      }
    }).finally(() => { sending.current = false; });
    return true;
  }
  async function exportData() {
    try {
      const result = await window.pet.companion({ type: 'state', forExport: true });
      const blob = new Blob([JSON.stringify(result.state.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '大肥鱼陪伴数据.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNote('导出失败，请重试'); }
  }
  if (!state) return <div className="loading">正在读取陪伴状态…{note}</div>;
  const disabled = pending || state.busy;
  return <div className="companion-panel">
    <div className="companion-tabs">{[['chat', '和她聊天'], ['studio', '学习工作室'], ['growth', '性格成长'], ['memory', '共同记忆'], ['mood', '心情与约定'], ['diary', '日记'], ['conversation', '对话设置'], ['settings', '陪伴设置']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}<span>{state.busy ? '正在想…' : state.ready ? '智能陪伴已启用' : '等待配置模型'}</span></div>
    {(note || state.error) && <div className="notice" role="status">{note || state.error}</div>}
    {state.notice && <p className="companion-help">{state.notice}</p>}
    {tab === 'conversation' && <ConversationSettings/>}
    {tab === 'studio' && <StudioPanel ready={state.ready}/>}
    {tab === 'growth' && <GrowthPanel state={state} disabled={disabled} request={request}/>}
    {tab === 'diary' && <DiaryPanel ready={state.ready} name={state.data.config.persona.name}/>}
    {tab === 'chat' && <section className="settings-card companion-chat">
      {!state.ready && <div className="companion-empty"><h3>让大肥鱼认识你</h3><p>在陪伴设置里连接本地或远程模型，就可以聊天、记住共同经历，并让表情跟着心情变化。</p><button className="primary" onClick={() => setTab('settings')}>配置智能陪伴</button></div>}
      <div className="companion-messages" ref={scroll.ref} onScroll={scroll.onScroll} tabIndex={0} role="region" aria-label="聊天记录">{state.data.events.map(e => <article className={`companion-message ${e.actor}`} key={e.id}><small>{e.actor === 'pet' ? state.data.config.persona.name : e.actor === 'system' ? '自主唤醒' : '你'} · {e.source === 'desktop' ? '桌面' : e.source} · {new Date(e.at).toLocaleTimeString()}</small><MarkdownContent text={e.text}/></article>)}{stream && !state.data.events.some(e => e.id === stream.id) && <article className="companion-message pet"><small>{state.data.config.persona.name} · 正在说…</small><MarkdownContent text={stream.text}/></article>}</div>
      {scroll.overflow && !scroll.atBottom && <div className="companion-scroll-actions"><button onClick={scroll.toLatest}>回到最新消息 ↓</button></div>}
      <textarea aria-label="对大肥鱼说" placeholder="和大肥鱼说点什么…（Ctrl + Enter 发送）" value={text} maxLength={4000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey && !disabled && state.ready) void send(); }}/>
      <VoiceInput purpose="chat" disabled={disabled || !state.ready} onBusy={setRecording} onText={send}/>
      <div className="companion-inline"><button className="primary" disabled={disabled || recording || !state.ready || !text.trim()} onClick={() => void send()}>发送</button><button onClick={() => void window.pet.companion({ type: 'cancel' }).then(r => setState(r.state))}>停止思考与朗读</button><button disabled={disabled} onClick={() => void request({ type: 'clear-history' })}>清空聊天</button></div>
      {!!state.recalls.length && <details><summary>这次想起了什么（{state.recalls.length}）</summary>{state.recalls.map(m => <p key={m.id}>{m.text}<small>{m.reason}</small></p>)}</details>}
    </section>}
    {tab === 'memory' && <div className="settings-stack"><section className="settings-card"><h3>记住一件事</h3><textarea aria-label="记忆内容" value={memory} maxLength={600} placeholder="例如：我喜欢安静，工作时不要频繁搭话。" onChange={e => setMemory(e.target.value)}/><div className="companion-columns"><label>类型<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="fact">长期事实</option><option value="preference">用户偏好</option><option value="episode">共同经历</option></select></label><label>事实键<input value={factKey} placeholder="例如 用户.称呼；经历可留空" onChange={e => setFactKey(e.target.value)}/></label><label>可见范围<select value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="private">私人：桌面与绑定私聊</option><option value="public">允许在群聊中使用</option></select></label></div><button disabled={disabled || !memory.trim()} onClick={() => void request({ type: 'remember', text: memory, factKey, kind, scope, pinned: kind !== 'episode' }).then(r => { if (r?.ok) setMemory(''); })}>保存记忆</button></section>
      <section className="settings-card"><div className="companion-inline"><input aria-label="检索记忆" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入一段话，检查她会想起什么"/><button disabled={disabled || !query.trim()} onClick={() => void request({ type: 'recall', query })}>检索</button><button onClick={exportData}>导出陪伴数据</button></div>{state.recalls.map(r => <p key={r.id}>{r.text}<small>{r.reason}</small></p>)}</section>
      <section className="settings-card"><h3>有效记忆</h3><p className="companion-help">同一事实键的新记录会替代旧记录。忘记会删除该事实的各个版本并清空聊天上下文。已导出的文件需要另行管理。</p>{state.data.memories.filter(m => !m.deletedAt && !m.supersededBy).slice().reverse().map(m => <article className="companion-memory" key={m.id}><div><p>{m.text}</p><small>{m.scope === 'public' ? '可公开' : '私人'} · {m.factKey || '经历'} · {new Date(m.eventAt).toLocaleDateString()}</small><details><summary>依据</summary>{m.evidence}</details></div><button disabled={disabled} onClick={() => void request({ type: 'forget', id: m.id })}>忘记</button></article>)}{!state.data.memories.length && <p>还没有记忆，可以先手动添加，也可以聊天后自动提炼。</p>}</section></div>}
    {tab === 'mood' && <div className="settings-stack"><section className="settings-card"><div className="companion-inline"><h3>此刻的心情 · {Math.round(state.data.mood.value)}</h3><button disabled={disabled} onClick={() => void request({ type: 'reset-mood' })}>回到平静</button></div>{emotionNames.map(name => <div className="companion-meter" key={name}><span>{emotionLabels[name]}</span><progress max={100} value={state.data.mood.emotions[name]}/><span>{Math.round(state.data.mood.emotions[name])}</span></div>)}<details><summary>心情变化的原因</summary>{state.data.mood.timeline.slice(-20).reverse().map(item => <p key={item.eventId}>{item.reason}<small>{new Date(item.at).toLocaleString()} · {emotionLabels[item.emotion]}</small></p>)}</details></section>
      <section className="settings-card"><h3>记着的约定</h3><label>约定内容<input value={goal} placeholder="例如：一起试试昨天没过的关卡" onChange={e => setGoal(e.target.value)}/></label><label>适合再提起的时间<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></label><button disabled={disabled || !goal.trim() || !Number.isFinite(new Date(due).getTime())} onClick={() => void request({ type: 'goal', text: goal, dueAt: new Date(due).getTime() }).then(r => { if (r?.ok) setGoal(''); })}>记下约定</button><p className="companion-help">启用主动搭话后，会在到期且适合打扰时提起。需要应用正在运行；提起约定不会自动标为完成。</p>{state.data.goals.filter(g => !g.completed).map(g => <div className="companion-memory" key={g.id}><p>{g.text}<small>{new Date(g.dueAt).toLocaleString()}</small></p><button disabled={disabled} onClick={() => void request({ type: 'complete-goal', id: g.id })}>已完成</button></div>)}</section></div>}
    {tab === 'settings' && <CompanionSettings config={draft} onChange={setDraft} secrets={secrets} onSecrets={setSecrets} state={state} onSave={() => void save()} onDiscover={() => void save(true)} disabled={disabled}/>}
  </div>;
}
