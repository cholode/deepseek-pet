import { growthDefaults, traitLabels, traitNames } from '../../shared/growth';
import type { CompanionRequest, CompanionView } from '../../shared/companion';

export function GrowthPanel({ state, disabled, request }: { state: CompanionView; disabled: boolean; request(value: CompanionRequest): Promise<unknown> }) {
  const growth = state.data.growth ?? growthDefaults;
  return <div className="settings-stack"><section className="settings-card"><h3>慢慢形成的相处方式</h3>
    <p className="companion-help">核心身份保留。最近 30 天内，至少 3 次不同对话中的一致明确反馈才调整 1 点，每项每天最多 2 点；课堂答题不作为性格依据。锁定后该项停止积累反馈。</p>
    <label><input type="checkbox" checked={growth.enabled} disabled={disabled} onChange={e => void request({ type: 'growth-configure', enabled: e.target.checked, locked: growth.locked })}/>允许根据相处反馈慢慢成长</label>
    {traitNames.map(trait => <div className="companion-meter" key={trait}><span>{traitLabels[trait]}</span><progress max={100} value={growth.values[trait]}/><span>{growth.values[trait]}</span><label><input type="checkbox" checked={growth.locked.includes(trait)} disabled={disabled} onChange={e => void request({ type: 'growth-configure', enabled: growth.enabled, locked: e.target.checked ? [...growth.locked, trait] : growth.locked.filter(t => t !== trait) })}/>锁定</label></div>)}
  </section><section className="settings-card"><h3>变化与依据</h3>{!growth.history.length && <p>还没有累积到足够的反馈，性格暂未变化。</p>}
    {growth.history.slice().reverse().map(item => <article className="companion-memory" key={item.id}><div><strong>{item.reason}</strong><small>{new Date(item.at).toLocaleString()}</small><p>{traitNames.filter(t => item.before[t] !== item.after[t]).map(t => `${traitLabels[t]} ${item.before[t]} → ${item.after[t]}`).join('；')}</p>{item.evidence.map((text, i) => <blockquote key={i}>{text}</blockquote>)}</div><button disabled={disabled} onClick={() => void request({ type: 'growth-rollback', id: item.id })}>恢复到这次变化前</button></article>)}
    <details><summary>待积累的反馈（{growth.observations.length}）</summary>{growth.observations.map((o, i) => <p key={i}>{traitLabels[o.trait]}：{o.evidence}<small>{o.reason}</small></p>)}</details>
  </section></div>;
}
