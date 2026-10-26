import { useEffect, useState } from 'react';
import type { DiaryRequest, DiaryView } from '../../shared/diary';
import './diary.css';

export function DiaryPanel({ ready, name }: { ready: boolean; name: string }) {
  const [state, setState] = useState<DiaryView>();
  const [directory, setDirectory] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const off = window.pet.onDiary(value => { if (live) setState(value); });
    void window.pet.diary({ type: 'state' }).then(async initial => {
      const r = initial.state.busy ? initial : await window.pet.diary({ type: 'refresh' });
      if (!live) return;
      setState(r.state); if (!r.ok) setError(r.message ?? '读取日记失败');
      if (r.ok && !r.state.busy && !r.state.selectedDate && r.state.files[0]) {
        const first = await window.pet.diary({ type: 'read', date: r.state.files[0].date });
        if (live) { setState(first.state); if (!first.ok) setError(first.message ?? '读取日记失败'); }
      }
    }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; off(); };
  }, []);
  // 只有目录真正变化时同步输入框，不让其他窗口的进度事件覆盖尚未保存的路径。
  useEffect(() => { if (state) setDirectory(state.directory); }, [state?.directory]);
  async function request(value: DiaryRequest) {
    setPending(true); setError('');
    try {
      const result = await window.pet.diary(value); setState(result.state);
      if (!result.ok) setError(result.message ?? '日记操作失败');
    } catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }
  if (!state) return <section className="settings-card">正在打开日记本…{error}</section>;
  const disabled = pending || state.busy;
  return <div className="diary-panel settings-stack">
    <section className="settings-card diary-heading">
      <div><small>把一起度过的日子留在纸上</small><h3>{name}的日记</h3><p className="companion-help">每天晚上自动留下一篇日记，错过了就下次启动补上。<br/>{ready ? '有对话时用已配置的模型整理；没有那一天的记录，就如实留一页空白纪事。' : '还没连接模型，先用本地纪事记下对话；无需联网。'}<br/>也可以手动再记一笔，同一天追加，已有内容会保留。</p></div>
      <div className="diary-actions"><button className="primary" disabled={disabled} onClick={() => void request({ type: 'write' })}>{state.busy ? '正在处理…' : '写今天的日记'}</button>{state.busy && <button onClick={() => void request({ type: 'cancel' })}>停止写日记</button>}</div>
    </section>
    <section className="settings-card diary-schedule" aria-label="自动日记">
      <div><span className="diary-time">21:00</span><strong>每天自动写 · 按本机时间</strong></div>
      <p>{state.automatic.writingDate ? `正在整理 ${state.automatic.writingDate} 的日记…` : state.automatic.waitingDays ? `还有 ${state.automatic.waitingDays} 天待补写，从 ${state.automatic.nextDate} 开始。` : `下一篇：${state.automatic.nextDate} 晚上 21:00`}</p>
      <small>{state.automatic.lastWrittenDate ? `最近完成：${state.automatic.lastWrittenDate}。` : `从 ${state.automatic.startedDate} 开始记录。`} 关闭程序期间漏掉的日期会逐篇补写，已完成的日期不会重复自动生成。</small>
      {state.automatic.error && <p className="diary-auto-error">{state.automatic.error}{state.automatic.retryAt > 0 && ` 下次重试：${new Date(state.automatic.retryAt).toLocaleString('zh-CN')}。`}</p>}
    </section>
    {(error || state.notice) && <div className="notice diary-notice" role="status">{error || state.notice}</div>}
    <section className="settings-card diary-location">
      <h3>保存位置</h3>
      <label>日记保存目录<input aria-label="日记保存目录" value={directory} maxLength={1000} onChange={e => setDirectory(e.target.value)} placeholder={state.defaultDirectory}/></label>
      <div className="companion-inline"><button disabled={disabled} onClick={() => void request({ type: 'choose-directory' })}>选择文件夹</button><button disabled={disabled || directory === state.directory} onClick={() => void request({ type: 'set-directory', directory })}>保存地址</button><button disabled={disabled || !state.customDirectory} onClick={() => void request({ type: 'set-directory', directory: '' })}>恢复默认位置</button><button disabled={disabled} onClick={() => void request({ type: 'open-directory' })}>打开日记文件夹</button></div>
      <small>默认位置：{state.defaultDirectory}<br/>更改地址只影响后续写入，旧日记留在原目录。日记是本地文件，不会自动发布。</small>
    </section>
    <section className="settings-card diary-reader">
      <div className="companion-inline"><h3>翻翻日记</h3><button disabled={disabled} onClick={() => void request({ type: 'refresh' })}>刷新列表</button></div>
      {!state.files.length ? <div className="diary-empty">日记本还是空的。晚上 21:00 我会来写，也可以现在先记一笔。</div> : <div className="diary-pages">
        <nav aria-label="日记日期">{state.files.map(file => <button key={file.date} aria-pressed={state.selectedDate === file.date} disabled={disabled} onClick={() => void request({ type: 'read', date: file.date })}>{file.date}</button>)}<small>显示最近 90 个日期</small></nav>
        <article aria-label="日记正文">{state.content ? <pre>{state.content.replace(/^<!-- dafeiyu-auto-diary:\d{4}-\d{2}-\d{2} -->\r?\n?/gm, '')}</pre> : <p>选一个日期，看看那天的故事。</p>}</article>
      </div>}
      <small>只整理当前仍保留的对应日期的桌面对话，不包含 QQ 对话。清空聊天不会删除已保存的日记。</small>
    </section>
  </div>;
}
