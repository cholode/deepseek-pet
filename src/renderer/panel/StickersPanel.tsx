import { useEffect, useState } from 'react';
import type { StickerItem, StickerRequest, StickerResponse, StickerSettings, StickerView } from '../../shared/stickers';
import './stickers.css';

export function StickersPanel() {
  const [state, setState] = useState<StickerView>();
  const [query, setQuery] = useState(''), [pack, setPack] = useState(''), [offset, setOffset] = useState(0);
  const [items, setItems] = useState<StickerItem[]>([]), [matches, setMatches] = useState(0), [selected, setSelected] = useState<StickerItem>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void window.pet.stickers({ type: 'state' }).then(result => { if (live) setState(result.state); }).catch(e => { if (live) setMessage(String(e)); });
    const off = window.pet.onStickers(value => { if (live) setState(value); });
    return () => { live = false; off(); };
  }, []);
  useEffect(() => {
    if (!state?.plugin) return;
    let live = true;
    const timer = setTimeout(() => { void window.pet.stickers({ type: 'search', query, pack, offset }).then(result => {
      if (!live) return;
      if (result.ok) { setItems(result.items ?? []); setMatches(result.matches ?? 0); } else setMessage(result.message ?? '搜索失败');
    }).catch(e => { if (live) setMessage(String(e)); }); }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [query, pack, offset, state?.plugin?.id, state?.plugin?.version, state?.cached]);
  async function request(value: StickerRequest): Promise<StickerResponse | undefined> {
    setMessage('');
    try { const result = await window.pet.stickers(value); setState(result.state); if (!result.ok) setMessage(result.message ?? '操作失败'); return result; }
    catch (e) { setMessage(String(e)); }
  }
  async function configure(patch: Partial<StickerSettings>) {
    if (!state) return;
    const previous = state, settings = { ...state.settings, ...patch };
    setState({ ...state, settings });
    const result = await request({ type: 'configure', settings });
    if (!result) setState(previous);
    if (result?.ok) setMessage('表情设置已保存');
  }
  async function preview(item: StickerItem, bubble = false) {
    setBusy(true); setSelected(item); setImageFailed(false);
    try { const result = await request({ type: 'preview', id: item.id, bubble }); if (result?.ok && result.item) setSelected(result.item); }
    finally { setBusy(false); }
  }
  const link = (url: string) => { void window.pet.openChatLink(url).catch(e => setMessage(String(e))); };
  const search = (value: string) => { setQuery(value); setOffset(0); };
  if (!state) return <p role="status">正在打开表情包…{message}</p>;
  if (!state.plugin) return <><div className="notice" role="alert">{state.notice || '表情插件未安装'}</div><button onClick={() => void request({ type: 'import-plugin' })}>导入表情包插件</button></>;
  return <div className="stickers-panel">
    <section className="settings-card sticker-settings">
      <div className="sticker-plugin-title"><div><h3>{state.plugin.name} <small>插件 {state.plugin.version}</small></h3><p>{state.total} 张表情 · 已下载 {state.cached} 张 · {(state.cacheBytes / 1024 / 1024).toFixed(1)} MB</p></div><span className={`sticker-status ${state.settings.enabled ? 'on' : ''}`}>{state.settings.enabled ? '大肥鱼可以使用' : '仅浏览预览'}</span></div>
      <label className="toggle-row"><span><strong>允许大肥鱼使用表情包</strong><small>根据聊天内容挑选，每次回复最多一张；首次使用时从素材站下载。</small></span><input type="checkbox" role="switch" checked={state.settings.enabled} onChange={e => void configure({ enabled: e.target.checked })}/><i/></label>
      <div className="sticker-options"><label>发送频率 <select aria-label="表情发送频率" value={state.settings.frequency} onChange={e => void configure({ frequency: e.target.value as StickerSettings['frequency'] })}><option value="rare">少量 · 有需要时</option><option value="normal">自然 · 偶尔表达</option><option value="often">活泼 · 轻松聊天多用</option></select></label><label><input type="checkbox" checked={state.settings.offline} onChange={e => void configure({ offline: e.target.checked })}/>仅使用已下载表情</label></div>
      <div className="sticker-pack-options"><span>大肥鱼可选的套组</span>{state.packs.map(group => <label key={group.name}><input type="checkbox" checked={state.settings.packs.includes(group.name)} onChange={e => void configure({ packs: e.target.checked ? [...state.settings.packs, group.name] : state.settings.packs.filter(name => name !== group.name) })}/>{group.name}（{group.count}）</label>)}</div>
    </section>
    {(message || state.notice) && <div className="notice" role="status">{message || state.notice}</div>}
    <div className="sticker-search"><input aria-label="搜索表情" placeholder="搜索名字、情绪或场景，比如：开心、摸鱼、鼓励" value={query} onChange={e => search(e.target.value)}/><select aria-label="浏览套组" value={pack} onChange={e => { setPack(e.target.value); setOffset(0); }}><option value="">全部套组</option>{state.packs.map(group => <option key={group.name}>{group.name}</option>)}</select></div>
    <div className="sticker-moods">{['全部', '开心', '打招呼', '感谢', '安慰', '摸鱼', '疑惑'].map(mood => <button key={mood} className={query === (mood === '全部' ? '' : mood) ? 'active' : ''} onClick={() => search(mood === '全部' ? '' : mood)}>{mood}</button>)}</div>
    <div className="sticker-workbench"><section aria-label="表情搜索结果"><div className="sticker-results-info">找到 {matches} 张 · 点开预览后下载，缓存可离线复用</div><div className="sticker-grid">{items.map(item => <button key={item.id} className={`sticker-tile ${selected?.id === item.id ? 'selected' : ''}`} disabled={busy} onClick={() => void preview(item)} aria-label={`预览 ${item.name}`}>
      <span className="sticker-thumbnail">{item.cached ? <img src={item.image} alt="" loading="lazy"/> : <span aria-hidden="true">◕‿◕</span>}</span><strong>{item.name}</strong><small>{item.emotion} · {item.pack}</small><span className="sticker-tile-state">{state.settings.blocked.includes(item.id) ? '已禁止自动选用' : item.cached ? '已下载' : '点按下载预览'}</span>
    </button>)}</div>{!items.length && <p className="empty">没有找到表情，试试“开心”或“摸鱼”。</p>}<div className="sticker-pages"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>上一页</button><span>{Math.floor(offset / 24) + 1} / {Math.max(1, Math.ceil(matches / 24))}</span><button disabled={offset + 24 >= matches} onClick={() => setOffset(offset + 24)}>下一页</button></div></section>
      <section className="sticker-preview settings-card" aria-label="表情预览">{selected ? <><h3>{selected.name}</h3><div className="sticker-large">{selected.cached && !imageFailed ? <img src={selected.image} alt={selected.name} onError={() => setImageFailed(true)}/> : <span>{busy ? '正在下载表情…' : imageFailed ? '缓存图片不可用，请重试' : '表情还没有下载成功'}</span>}</div><div className="tags"><span>{selected.emotion}</span>{selected.tags.slice(0, 5).map(tag => <span key={tag}>{tag}</span>)}</div><p>{selected.use}</p>{selected.direction && <small>{selected.direction}</small>}<details><summary>画面与出处</summary><p>{selected.description}</p>{selected.meme && <p>{selected.meme}</p>}</details><div className="sticker-preview-actions"><button className="primary" disabled={busy} onClick={() => void preview(selected, true)}>在气泡预览</button><button disabled={busy} onClick={() => void preview(selected)}>重新加载</button></div><label className="sticker-block"><input type="checkbox" checked={state.settings.blocked.includes(selected.id)} onChange={e => void configure({ blocked: e.target.checked ? [...new Set([...state.settings.blocked, selected.id])] : state.settings.blocked.filter(id => id !== selected.id) })}/>不让大肥鱼自动选用这张</label></> : <div className="sticker-preview-empty"><span>◕‿◕</span><h3>挑一张看看</h3><p>点左侧的表情，查看动态效果和适合使用的场景。</p></div>}</section>
    </div>
    <footer className="sticker-credit"><div><span>表情作者：{state.plugin.author}</span><div><button onClick={() => link(state.plugin!.authorUrl)}>作者主页 ↗</button><button onClick={() => link(state.plugin!.origin)}>素材网站 ↗</button><button onClick={() => link(state.plugin!.source)}>原插件项目 ↗</button></div><small>{state.plugin.license}</small></div><div className="sticker-maintenance"><button disabled={busy} onClick={() => { setBusy(true); void request({ type: 'import-plugin' }).then(result => { if (result?.ok) { setSelected(undefined); setPack(''); search(''); setMessage(result.message ?? '插件已更新'); } }).finally(() => setBusy(false)); }}>导入／更新插件</button><button disabled={busy || !state.cached} onClick={() => { setBusy(true); void request({ type: 'clear-cache' }).then(result => { if (result?.ok) { setSelected(undefined); setMessage('已清理下载缓存，表情设置已保留'); } }).finally(() => setBusy(false)); }}>清理下载缓存</button></div></footer>
  </div>;
}
