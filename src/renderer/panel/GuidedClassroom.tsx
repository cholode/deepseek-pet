import { useEffect, useRef, useState } from 'react';
import type { Lesson, StudySession, StudioRequest, StudioResponse } from '../../shared/studio';
import { teachingMethod } from '../../companion/teaching';
import { MarkdownContent } from '../chat/MarkdownContent';

type Props = {
  lesson: Lesson;
  session: StudySession;
  ready: boolean;
  pending: boolean;
  hasReviewTarget: boolean;
  send(request: StudioRequest): Promise<StudioResponse | undefined>;
};
const statusLabels = { active: '上课中', paused: '已暂停', completed: '本课已结束' };
const exportLabels = { none: '未同步', pending: '正在同步', completed: '已同步', unknown: '结果待核查' };

// 带学页面只呈现已经发生的师生对话，不读取 current.referenceAnswer 或内部教学阶段。
// 作答、提问、提示与暂停继续走同一学习服务，避免页面另建一份课堂状态。
export function GuidedClassroom({ lesson, session, ready, pending, hasReviewTarget, send }: Props) {
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const conversation = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const tutoring = session.tutoring;
  const turns = tutoring?.turns ?? [];
  const active = session.status === 'active';

  useEffect(() => {
    const element = conversation.current;
    if (element && followTail.current) element.scrollTop = element.scrollHeight;
  }, [turns.length, tutoring?.current?.reply, pending]);

  async function submit() {
    if (pending || !ready || !active || !draft.trim()) return;
    followTail.current = true;
    const result = await send({ type: 'answer', sessionId: session.id, answer: draft, requestId: crypto.randomUUID() });
    if (result?.ok) setDraft('');
  }

  return <section className="settings-card studio-classroom studio-guided">
    <h3>老师带我学 · {lesson.title}</h3>
    <p>{teachingMethod(tutoring?.methodId).name} · {statusLabels[session.status]} · 已记录 {session.attempts.length} 次作答</p>
    <div className="studio-guided-log" ref={conversation} role="log" aria-label="带学课堂对话" aria-live="polite" aria-busy={pending} tabIndex={0} onScroll={() => {
      const element = conversation.current;
      if (element) followTail.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
    }}>
      {turns.map(turn => <article className="studio-guided-turn" key={turn.id}>
        {!!turn.user && <div className="studio-guided-message student"><strong>你</strong><p>{turn.user}</p></div>}
        <div className="studio-guided-message teacher"><strong>大肥鱼</strong><MarkdownContent text={turn.reply}/></div>
      </article>)}
      {!turns.length && tutoring?.current?.reply && <div className="studio-guided-message teacher"><strong>大肥鱼</strong><MarkdownContent text={tutoring.current.reply}/></div>}
      {!turns.length && !tutoring?.current?.reply && <p className="companion-help">课堂准备好后，大肥鱼会从一个小问题开始。</p>}
      {pending && <p className="companion-help" role="status">正在处理…</p>}
    </div>

    {session.status !== 'completed' ? <>
      <label htmlFor={`guided-input-${session.id}`}>和老师说</label>
      <textarea id={`guided-input-${session.id}`} aria-label="带学课堂输入" value={draft} maxLength={4000} disabled={pending || !ready || !active} onChange={e => setDraft(e.target.value)} placeholder="可以作答、提问，或告诉大肥鱼哪里没听懂。"/>
      <div className="companion-inline studio-guided-actions">
        <button className="primary" disabled={pending || !ready || !active || !draft.trim()} onClick={() => void submit()}>发送给老师</button>
        <button disabled={pending || !ready || !active} onClick={() => void send({ type: 'session', id: session.id, action: 'hint' })}>给我一点提示</button>
        <button disabled={pending} onClick={() => void send({ type: 'session', id: session.id, action: active ? 'pause' : 'resume' })}>{active ? '暂停课堂' : '继续课堂'}</button>
        <button disabled={pending || !session.attempts.length} onClick={() => void send({ type: 'session', id: session.id, action: 'finish' })}>结束本课并复盘</button>
      </div>
      {session.status === 'paused' && <p className="companion-help">进度已保留。想接着学时，点“继续课堂”。</p>}
      {!session.attempts.length && <p className="companion-help">完成一次作答后可以结束本课并生成复盘，也可以随时暂停。</p>}
    </> : <>
      <h4>课后复盘</h4><MarkdownContent text={session.reflection || '本课已结束，课后复盘待处理。'}/>
      <p>学习记录：{exportLabels[session.exportState]}</p>
      {session.exportResult && <details><summary>同步结果</summary><p>{session.exportResult}</p></details>}
      <div className="companion-inline studio-guided-actions">
        <button disabled={pending || !ready} onClick={() => void send({ type: 'session', id: session.id, action: 'reflect' })}>重新复盘</button>
        <button disabled={pending || !hasReviewTarget} onClick={() => void send({ type: 'session', id: session.id, action: 'export-review' })}>同步 / 核查后重试记录</button>
      </div>
    </>}
    <details><summary>给大肥鱼教学反馈</summary><textarea aria-label="带学教学反馈" value={feedback} maxLength={1500} onChange={e => setFeedback(e.target.value)} placeholder="例如：讲慢一些，或多用生活场景。"/><button disabled={pending || !feedback.trim()} onClick={() => void send({ type: 'feedback', sessionId: session.id, text: feedback }).then(result => { if (result?.ok) setFeedback(''); })}>保存反馈</button></details>
  </section>;
}
