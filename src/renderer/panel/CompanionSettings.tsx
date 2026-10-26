import { useEffect, useState } from 'react';
import type { CompanionConfig, CompanionView } from '../../shared/companion';
type Secrets = Partial<Record<'model' | 'qq' | 'mcp', string>>;
interface Props { config: CompanionConfig; onChange: (config: CompanionConfig) => void; secrets: Secrets; onSecrets: (value: Secrets) => void; state: CompanionView; onSave: () => void; onDiscover: () => void; disabled: boolean }
export function CompanionSettings({ config: c, onChange, secrets, onSecrets, state, onSave, onDiscover, disabled }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return;
    const refresh = () => setVoices(synthesis.getVoices().filter(v => v.localService));
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, []);
  const section = <K extends keyof CompanionConfig>(key: K, value: Partial<CompanionConfig[K]>) => onChange({ ...c, [key]: { ...(c[key] as object), ...value } });
  const secret = (name: 'model' | 'qq' | 'mcp', title: string) => <label>{title}<div className="companion-inline"><input aria-label={title} type="password" autoComplete="off" value={secrets[name] ?? ''} placeholder={state.hasSecrets[name] ? '已加密保存，留空不修改' : '本地无鉴权服务可留空'} onChange={e => onSecrets({ ...secrets, [name]: e.target.value })}/><button type="button" onClick={() => onSecrets({ ...secrets, [name]: '' })}>清除密钥</button></div>{secrets[name] === '' && <small>保存后清除已存密钥</small>}</label>;
  return <div className="companion-settings">
    <section className="settings-card"><h3>人格与模型</h3>
      <label className="companion-check"><input type="checkbox" checked={c.enabled} onChange={e => onChange({ ...c, enabled: e.target.checked })}/>启用智能陪伴</label>
      <div className="companion-columns"><label>角色称呼<input value={c.persona.name} onChange={e => section('persona', { name: e.target.value })}/></label><label>她如何称呼你<input value={c.persona.userName} onChange={e => section('persona', { userName: e.target.value })}/></label></div>
      <label>稳定人格<textarea rows={4} value={c.persona.description} onChange={e => section('persona', { description: e.target.value })}/></label>
      <label>模型服务地址<input aria-label="模型服务地址" value={c.model.baseUrl} onChange={e => section('model', { baseUrl: e.target.value })}/><small>填写兼容 Chat Completions 的基础地址，例如 http://127.0.0.1:11434/v1 或 https://api.deepseek.com。</small></label>
      <label>模型名称<input aria-label="模型名称" value={c.model.model} placeholder="填写服务中实际可用的模型 ID" onChange={e => section('model', { model: e.target.value })}/></label>
      {secret('model', '模型 API Key')}
      <p className="companion-help">普通模式继续离线运行。启用后，发送的聊天与相关记忆会交给这里配置的模型；情绪和记忆提炼会额外调用一次模型。</p>
    </section>
    <section className="settings-card"><h3>记忆、心情与主动搭话</h3>
      <label className="companion-check"><input type="checkbox" checked={c.memory.automatic} onChange={e => section('memory', { automatic: e.target.checked })}/>自动提炼有原话依据的记忆</label>
      <label className="companion-check"><input type="checkbox" checked={c.mood.enabled} onChange={e => section('mood', { enabled: e.target.checked })}/>根据互动更新心情与动作</label>
      <div className="companion-columns"><label>经历半衰期（天）<input type="number" min={1} max={3650} value={c.memory.halfLifeDays} onChange={e => section('memory', { halfLifeDays: Number(e.target.value) })}/></label><label>心情回稳半衰期（小时）<input type="number" min={1} max={168} value={c.mood.halfLifeHours} onChange={e => section('mood', { halfLifeHours: Number(e.target.value) })}/></label></div>
      <label className="companion-check"><input type="checkbox" checked={c.initiative.enabled} onChange={e => section('initiative', { enabled: e.target.checked })}/>允许她围绕约定和共同经历主动搭话</label>
      <div className="companion-columns"><label>无互动多久后可搭话（分钟）<input type="number" min={1} max={1440} value={c.initiative.idleMinutes} onChange={e => section('initiative', { idleMinutes: Number(e.target.value) })}/></label><label>搭话冷却（分钟）<input type="number" min={1} max={1440} value={c.initiative.cooldownMinutes} onChange={e => section('initiative', { cooldownMinutes: Number(e.target.value) })}/></label></div>
      <div className="companion-columns"><label>安静时段开始（小时）<input type="number" min={0} max={23} value={c.initiative.quietStart} onChange={e => section('initiative', { quietStart: Number(e.target.value) })}/></label><label>安静时段结束（小时）<input type="number" min={0} max={23} value={c.initiative.quietEnd} onChange={e => section('initiative', { quietEnd: Number(e.target.value) })}/></label><label>每天最多主动搭话<input type="number" min={1} max={20} value={c.initiative.dailyLimit} onChange={e => section('initiative', { dailyLimit: Number(e.target.value) })}/></label></div>
      <small>开始与结束相同表示不设安静时段。应用退出、休眠或暂停自动行为时不会后台唤醒。</small>
    </section>
    <section className="settings-card"><h3>声音</h3>
      <label className="companion-check"><input type="checkbox" checked={c.speech.enabled} onChange={e => section('speech', { enabled: e.target.checked })}/>使用系统本地语音朗读回复</label>
      <label>本地声音<select value={c.speech.voice} onChange={e => section('speech', { voice: e.target.value })}><option value="">自动选择中文语音</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></label>
      {!voices.some(v => /^zh/.test(v.lang)) && <p className="companion-help">尚未检测到本地中文语音。可在 Windows“设置 → 时间和语言 → 语音”中安装；当前仍可显示文字。</p>}
      <label>语速<input type="range" min={0.5} max={2} step={0.1} value={c.speech.rate} onChange={e => section('speech', { rate: Number(e.target.value) })}/></label>
      <small>使用 Windows 已安装的中文语音。没有本地语音时仍显示文字；停止按钮会同时停止朗读与清空队列。</small>
    </section>
    <section className="settings-card"><h3>QQ 通道</h3>
      <label className="companion-check"><input type="checkbox" checked={c.qq.enabled} onChange={e => section('qq', { enabled: e.target.checked })}/>启用绑定用户的 QQ 文字收发</label>
      <label>本机 OneBot 11 HTTP 地址<input value={c.qq.baseUrl} onChange={e => section('qq', { baseUrl: e.target.value })}/></label>
      {secret('qq', 'OneBot 访问令牌')}
      <div className="companion-columns"><label>会话类型<select value={c.qq.kind} onChange={e => section('qq', { kind: e.target.value as 'private' | 'group' })}><option value="private">私聊</option><option value="group">群聊</option></select></label><label>目标 QQ / 群号<input value={c.qq.targetId} onChange={e => section('qq', { targetId: e.target.value })}/></label><label>允许发起对话的 QQ 号<input value={c.qq.ownerId} onChange={e => section('qq', { ownerId: e.target.value })}/></label></div>
      <p className="companion-help">需要自己运行并登录 OneBot 后端。只回复绑定用户；群聊需 @ 机器人或以“大肥鱼”开头。QQ 对话不会调用电脑工具，群聊不会读取私人记忆。</p>
    </section>
    <section className="settings-card"><h3>MCP 工具</h3>
      <label className="companion-check"><input type="checkbox" checked={c.mcp.enabled} onChange={e => section('mcp', { enabled: e.target.checked })}/>连接 MCP Streamable HTTP 服务</label>
      <label>MCP 地址<input value={c.mcp.url} placeholder="http://127.0.0.1:端口/mcp" onChange={e => section('mcp', { url: e.target.value, allowedTools: [] })}/></label>
      {secret('mcp', 'MCP Bearer Token')}
      <button disabled={disabled} onClick={onDiscover}>保存并发现工具</button>
      <p className="companion-help">勾选后，大肥鱼可在桌面聊天中调用这些工具。每轮最多 4 次；主动搭话和 QQ 均不可调用。仅启用你愿意交给她操作的能力。</p>
      {state.tools.map(t => <label className="companion-tool" key={t.name}><input type="checkbox" checked={c.mcp.allowedTools.includes(t.name)} onChange={e => section('mcp', { allowedTools: e.target.checked ? [...c.mcp.allowedTools, t.name] : c.mcp.allowedTools.filter(n => n !== t.name) })}/><span><b>{t.name}</b><small>{t.description}</small></span></label>)}
    </section>
    <button className="primary companion-save" disabled={disabled} onClick={onSave}>保存陪伴设置</button>
  </div>;
}
