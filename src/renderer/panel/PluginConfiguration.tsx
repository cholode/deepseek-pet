import { useState } from 'react';
import type { SoftwareEntryView, SoftwarePlugin, SoftwareRequest, SoftwareResponse } from '../../shared/software';

export function PluginConfiguration({ entry, plugin, disabled, request }: {
  entry: SoftwareEntryView; plugin: SoftwarePlugin; disabled: boolean;
  request(value: SoftwareRequest): Promise<SoftwareResponse | undefined>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>();
  const [summary, setSummary] = useState('');
  const [decks, setDecks] = useState<string[]>([]);
  const config = plugin.configuration;
  if (!config) return null;
  const granted = (tool: string) => entry.enabled && entry.grants.some(g => g.name === tool);
  async function load(operation: 'read' | 'write') {
    const result = await request({ type: 'configure-plugin', id: entry.id, operation, ...(operation === 'write' ? { settings: values } : {}) });
    if (!result?.ok) return;
    const data = result.result as { settings?: Record<string, unknown>; summary?: string; decks?: string[] };
    if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) setValues(data.settings);
    setSummary(typeof data?.summary === 'string' ? data.summary : '插件设置已更新');
    if (Array.isArray(data?.decks)) setDecks(data.decks.filter(d => typeof d === 'string').slice(0, 80));
  }
  return <section className="plugin-configuration software-form" aria-label={config.title}>
    <div className="software-section-title"><h3>{config.title}</h3><button disabled={disabled || !granted(config.readTool)} onClick={() => void load('read')}>读取计划与学习状态</button></div>
    {!granted(config.readTool) && <p className="software-help">连接后，在下方授权设置读取和保存能力，即可配置学习计划。</p>}
    {summary && <p className="software-help" role="status">{summary}</p>}
    {values && <>
      <div className="plugin-settings-grid">{config.fields.map(field => <label key={field.key}>{field.label}
        {field.type === 'weekdays' ? <span className="plugin-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((label, day) => <span key={day}><input aria-label={`周${label}`} type="checkbox" disabled={disabled} checked={Array.isArray(values[field.key]) && (values[field.key] as unknown[]).includes(day)} onChange={e => { const days = Array.isArray(values[field.key]) ? values[field.key] as number[] : []; setValues({ ...values, [field.key]: e.target.checked ? [...days, day] : days.filter(d => d !== day) }); }}/>{label}</span>)}</span>
          : field.type === 'select' ? <select aria-label={field.label} value={String(values[field.key] ?? '')} disabled={disabled} onChange={e => setValues({ ...values, [field.key]: e.target.value })}>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
            : <input aria-label={field.label} type={field.type === 'number' ? 'number' : field.type === 'time' ? 'time' : 'text'} disabled={disabled} min={field.min} max={field.max} maxLength={120} value={typeof values[field.key] === 'number' ? values[field.key] as number : String(values[field.key] ?? '')} onChange={e => setValues({ ...values, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value })}/>}
      </label>)}</div>
      {decks.length > 0 && <details className="software-help"><summary>Anki 已有牌组（可复制到复习牌组）</summary><p>{decks.join(' / ')}</p></details>}
      <button className="primary" disabled={disabled || !granted(config.writeTool)} onClick={() => void load('write')}>保存学习计划</button>
    </>}
    {plugin.reminderTool && <div className="plugin-reminder"><label className="software-check"><input type="checkbox" checked={entry.remindersEnabled} disabled={disabled || !granted(plugin.reminderTool)} onChange={e => void request({ type: 'reminders', id: entry.id, enabled: e.target.checked })}/>开启计划提醒</label><small>大肥鱼运行时按电脑本地时间提醒；暂停自动行为或电脑休眠时不打扰。同一天同一时间最多提醒一次，错过后两小时内补提醒。先保存计划，再开启。</small></div>}
    <p className="software-help">可以对大肥鱼说：“陪我练习日语，把纠错和生词记到 Anki”，或“复习今天到期的卡片”。</p>
  </section>;
}
