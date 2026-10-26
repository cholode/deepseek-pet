import { useEffect, useState } from 'react';
import type { InstalledSoftwarePlugin, SoftwareDraft, SoftwareEntryView, SoftwareRequest, SoftwareView } from '../../shared/software';
import './software.css';

const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '需要处理' };
const activityLabels = { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消' };
function Permissions({ entry, disabled, save }: { entry: SoftwareEntryView; disabled: boolean; save(tools: string[]): void }) {
  const [selected, setSelected] = useState(entry.grants.map(g => g.name));
  return <div className="software-permissions">
    <div className="software-section-title"><strong>插件提供的能力</strong><span>{selected.length} / {entry.tools.length} 项已选择</span></div>
    {!entry.tools.length ? <p className="software-help">{entry.status === 'connected' ? '插件连接成功，目前没有提供工具。请由插件作者实现相应能力。' : '连接插件后，这里会列出它实际提供的工具。'}</p> : <>
      {entry.tools.map(tool => <label className="software-tool" key={tool.name}>
        <input type="checkbox" disabled={disabled || entry.status !== 'connected'} checked={selected.includes(tool.name)} onChange={e => setSelected(e.target.checked ? [...selected, tool.name] : selected.filter(name => name !== tool.name))}/>
        <span><b>{tool.name}</b><small>{tool.description || '插件未提供说明'}</small></span>
      </label>)}
      <button disabled={disabled || entry.status !== 'connected'} onClick={() => save(selected)}>保存工具授权</button>
    </>}
  </div>;
}
function PluginCard({ plugin, disabled, remove }: { plugin: InstalledSoftwarePlugin; disabled: boolean; remove(): void }) {
  const manifest = plugin.manifest;
  return <article className="software-plugin-card">
    <div className="software-card-title"><div><h3>{manifest.name}</h3><small>{manifest.id} · v{manifest.version}{manifest.author && ` · ${manifest.author}`}</small></div><span className="software-badge">{manifest.transport.type === 'stdio' ? '本地插件' : '服务插件'}</span></div>
    <p>{manifest.description}</p>
    <small>{manifest.transport.type === 'stdio' ? `运行方式：${manifest.transport.runtime} · 入口：${manifest.transport.entry}` : '连接方式：MCP Streamable HTTP'}</small>
    <div className="software-card-actions"><span>导入后不会自动运行</span><button disabled={disabled} onClick={remove}>移除插件</button></div>
  </article>;
}
export function SoftwarePanel({ configureModel }: { configureModel(): void }) {
  const [state, setState] = useState<SoftwareView>(); const [working, setWorking] = useState(false); const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'software' | 'plugins'>('software'); const [draft, setDraft] = useState<SoftwareDraft>();
  const [token, setToken] = useState(''); const [clearToken, setClearToken] = useState(false); const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void window.pet.software({ type: 'state' }).then(r => { if (live) setState(r.state); }).catch(e => { if (live) setNotice(String(e)); });
    void window.pet.companion({ type: 'state' }).then(r => { if (live) setReady(r.state.ready); }).catch(() => {});
    const off = window.pet.onSoftware(value => { if (live) setState(value); });
    const companion = window.pet.onCompanion(value => { if (live) setReady(value.ready); });
    return () => { live = false; off(); companion(); };
  }, []);
  async function request(value: SoftwareRequest) {
    setWorking(true); setNotice('');
    try { const result = await window.pet.software(value); setState(result.state); if (!result.ok) setNotice(result.message || '操作失败'); return result; }
    catch (e) { setNotice(String(e)); }
    finally { setWorking(false); }
  }
  function edit(entry?: SoftwareEntryView) {
    setDraft(entry ? { id: entry.id, name: entry.name, directory: entry.directory, pluginId: entry.pluginId, runtimePath: entry.runtimePath, url: entry.url } : { name: '', directory: '', pluginId: state?.plugins[0]?.manifest.id ?? '', runtimePath: '', url: state?.plugins[0]?.manifest.transport.type === 'streamable-http' ? state.plugins[0].manifest.transport.defaultUrl : '' });
    setToken(''); setClearToken(false); setTab('software');
  }
  const disabled = working || Boolean(state?.busy), selectedPlugin = state?.plugins.find(p => p.manifest.id === draft?.pluginId)?.manifest;
  async function choose(kind: 'directory' | 'runtime') {
    if (!draft) return;
    const result = await request({ type: kind === 'directory' ? 'choose-directory' : 'choose-runtime', current: kind === 'directory' ? draft.directory : draft.runtimePath });
    if (result?.selectedPath) setDraft({ ...draft, ...(kind === 'directory' ? { directory: result.selectedPath, name: draft.name || result.selectedPath.split(/[\\/]/).filter(Boolean).pop() || '' } : { runtimePath: result.selectedPath }) });
  }
  if (!state) return <div className="loading">正在读取软件与插件…{notice && <p role="status">{notice}</p>}</div>;
  return <div className="software-panel">
    <section className="software-intro"><div><span className="tiny-pill">把能力交给插件</span><h2>选好软件，让大肥鱼来帮忙。</h2><p>导入对应插件，定位软件目录，选择允许使用的能力。后续在聊天中告诉大肥鱼要做什么。</p></div><div className="software-steps"><span><b>1</b>导入插件</span><i>→</i><span><b>2</b>关联软件</span><i>→</i><span><b>3</b>连接与授权</span></div></section>
    {!ready && <div className="software-model-hint"><span>软件和插件可以先配置，聊天调用需要启用智能陪伴。</span><button onClick={configureModel}>配置模型</button></div>}
    {(notice || state.notice) && <div className="notice" role="status">{notice || state.notice}</div>}
    <div className="software-toolbar"><div role="tablist" aria-label="软件管理"><button role="tab" aria-selected={tab === 'software'} onClick={() => setTab('software')}>软件列表 <span>{state.entries.length}</span></button><button role="tab" aria-selected={tab === 'plugins'} onClick={() => setTab('plugins')}>插件库 <span>{state.plugins.length}</span></button></div><button disabled={disabled} onClick={() => void request({ type: 'import-plugin' })}>导入软件插件</button><button className="primary" disabled={disabled || !state.plugins.length} onClick={() => edit()}>＋ 添加软件</button></div>
    {tab === 'software' && <>
      {draft && <section className="settings-card software-form" aria-label="软件配置"><div className="software-section-title"><h3>{draft.id ? '编辑软件' : '添加可操作软件'}</h3><button disabled={disabled} onClick={() => setDraft(undefined)}>收起</button></div>
        <label>软件名称<input maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
        <label>软件所在目录<div className="software-path"><input aria-label="软件所在目录" value={draft.directory} placeholder="选择软件安装或所在文件夹" onChange={e => setDraft({ ...draft, directory: e.target.value })}/><button disabled={disabled} onClick={() => void choose('directory')}>定位目录</button></div></label>
        <label>关联插件<select aria-label="关联插件" value={draft.pluginId} onChange={e => { const plugin = state.plugins.find(p => p.manifest.id === e.target.value)!.manifest; setDraft({ ...draft, pluginId: plugin.id, runtimePath: '', url: plugin.transport.type === 'streamable-http' ? plugin.transport.defaultUrl : '' }); setToken(''); setClearToken(false); }}><option value="" disabled>选择已导入的插件</option>{state.plugins.map(p => <option key={p.manifest.id} value={p.manifest.id}>{p.manifest.name} · {p.manifest.version}</option>)}</select></label>
        {selectedPlugin && <p className="software-help">{selectedPlugin.description}</p>}
        {selectedPlugin?.transport.type === 'stdio' && selectedPlugin.transport.runtime !== 'executable' && <label>运行时可执行文件（{selectedPlugin.transport.runtime === 'node' ? 'Node.js' : 'Python'}）<div className="software-path"><input aria-label="运行时可执行文件" placeholder="例如 node.exe 或 python.exe 的完整路径" value={draft.runtimePath} onChange={e => setDraft({ ...draft, runtimePath: e.target.value })}/><button disabled={disabled} onClick={() => void choose('runtime')}>选择运行时</button></div></label>}
        {selectedPlugin?.transport.type === 'streamable-http' && <><label>插件服务地址<input value={draft.url} placeholder="http://127.0.0.1:端口/mcp" onChange={e => setDraft({ ...draft, url: e.target.value })}/></label><label>插件访问令牌（可选）<input type="password" autoComplete="off" value={token} placeholder="留空保留已有令牌；变更地址后需重新填写" onChange={e => { setToken(e.target.value); setClearToken(false); }}/></label><label className="software-check"><input type="checkbox" checked={clearToken} onChange={e => { setClearToken(e.target.checked); setToken(''); }}/>清除已保存的访问令牌</label></>}
        <p className="software-help">连接本地插件会启动其程序，请使用信任的来源。软件目录会传给插件用于定位；具体可操作范围由插件实现。更换目录、插件或连接信息后需要重新授权。</p>
        <button className="primary" disabled={disabled || !draft.name.trim() || !draft.directory.trim() || !selectedPlugin} onClick={() => void request({ type: 'save', software: draft, ...(clearToken || token ? { token: clearToken ? '' : token } : {}) }).then(result => { if (result?.ok) { setDraft(undefined); setToken(''); } })}>保存软件</button>
      </section>}
      {!state.entries.length && !draft && <div className="software-empty"><div className="software-empty-symbol">▤</div><h3>还没有关联软件</h3><p>{state.plugins.length ? '选择一个软件目录，再为它关联相应插件。' : '先导入下载并解压后的软件插件。插件会告诉大肥鱼可以做什么。'}</p><small>当前提供通用接入框架，尚未预装具体软件的操作插件。</small></div>}
      <div className="software-list">{state.entries.map(entry => <article className="settings-card software-card" key={entry.id} aria-label={`软件 ${entry.name}`}>
        <div className="software-card-title"><div><h3>{entry.name}</h3><small className="software-directory" title={entry.directory}>{entry.directory}</small></div><span className={`software-badge ${entry.status}`}>{labels[entry.status]}{!entry.enabled && ' · 已停用'}</span></div>
        <p className="software-binding">{state.plugins.find(p => p.manifest.id === entry.pluginId)?.manifest.name ?? '关联插件未安装'}<span>{entry.grants.length} 项已授权</span></p>
        {entry.error && <p className="software-error" role="status">{entry.error}</p>}
        <div className="software-card-actions"><button className="primary" disabled={disabled || !state.plugins.some(p => p.manifest.id === entry.pluginId)} onClick={() => void request({ type: 'connect', id: entry.id })}>{entry.status === 'connected' ? '重新连接并刷新能力' : '连接并读取能力'}</button><button disabled={disabled || !entry.enabled} onClick={() => void request({ type: 'disable', id: entry.id })}>停用</button><button disabled={disabled} onClick={() => edit(entry)}>编辑</button><button disabled={disabled} onClick={() => void request({ type: 'remove', id: entry.id })}>移除关联</button></div>
        <Permissions key={`${entry.id}:${JSON.stringify(entry.grants)}:${entry.tools.map(t => t.signature).join(',')}`} entry={entry} disabled={disabled} save={tools => void request({ type: 'grant', id: entry.id, tools })}/>
      </article>)}</div>
    </>}
    {tab === 'plugins' && <><p className="software-help">插件目录须包含 software-plugin.json。支持本地进程与 MCP 服务，导入后可以关联多个软件。更新插件时先移除旧版，再导入新版并重新授权。</p><div className="software-plugin-list">{state.plugins.map(plugin => <PluginCard key={plugin.manifest.id} plugin={plugin} disabled={disabled} remove={() => void request({ type: 'remove-plugin', id: plugin.manifest.id })}/>)}</div>{!state.plugins.length && <div className="software-empty"><h3>插件库还是空的</h3><p>点击“导入软件插件”，选择已下载并解压的插件文件夹。</p></div>}</>}
    <section className="software-bottom"><div><strong>操作控制</strong><p>仅桌面聊天可以使用已授权能力。停止会断开插件，之后需重新连接。</p></div><button onClick={() => void request({ type: 'stop' })}>停止并停用全部软件</button></section>
    {state.activities.length > 0 && <details className="software-activity"><summary>最近操作（{state.activities.length}）</summary>{[...state.activities].reverse().map(item => <div key={item.id}><time>{new Date(item.at).toLocaleTimeString()}</time><span>{item.software} · {item.tool}</span><b>{activityLabels[item.status]}</b>{item.message && <small>{item.message}</small>}</div>)}</details>}
  </div>;
}
