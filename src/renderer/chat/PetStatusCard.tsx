import { emotionLabels } from '../../shared/companion';
import type { QuickChatState } from '../../shared/pet-chat';

export function PetStatusCard({ state }: { state: QuickChatState }) {
  const status = state.status;
  const mood = status?.mood;
  return <section className="pet-status" aria-label="大肥鱼当前状态">
    <header><strong title={state.name}>{state.name}</strong><span className={state.busy ? 'is-busy' : ''}><i/>{state.streaming ? '正在回复' : state.busy ? '正在思考' : '此刻的我'}</span></header>
    <div className="pet-status-mood">
      <div><span>心情 · {mood ? emotionLabels[mood.emotion] : '尚未启用'}</span><small>{mood ? `${mood.value} / 100` : '—'}</small></div>
      <progress aria-label="当前心情" max={100} value={mood?.value ?? 0} title={mood ? '根据互动与对话变化的心情值' : '启用智能陪伴与情绪后显示心情'}/>
    </div>
    <dl>
      <div><dt>当前动作</dt><dd title={status?.action}>{status?.action ?? '正在读取…'}</dd></div>
      <div><dt>自主活动</dt><dd title={status?.behavior}>{status?.behavior ?? '正在读取…'}</dd></div>
      <div><dt>陪伴模式</dt><dd>{status?.mode === 'ai' ? '智能陪伴' : '普通陪伴'}</dd></div>
      <div><dt>语音朗读</dt><dd>{status?.speechEnabled ? '已开启' : '未开启'}</dd></div>
    </dl>
  </section>;
}
