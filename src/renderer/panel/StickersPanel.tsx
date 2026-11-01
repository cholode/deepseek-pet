import { useEffect, useState } from 'react';
import { localStickerPack, type StickerItem, type StickerRequest, type StickerResponse, type StickerSettings, type StickerView } from '../../shared/stickers';
import './stickers.css';

type Details = Extract<StickerRequest, { type: 'edit-local' }>['details'];
function LocalStickerEditor({ item, busy, save, remove }: { item: StickerItem; busy: boolean; save(details: Details): void; remove(): void }) {
  const [name, setName] = useState(item.name), [emotion, setEmotion] = useState(item.emotion);
  const [tags, setTags] = useState(item.tags.join('，')), [use, setUse] = useState(item.use), [confirm, setConfirm] = useState(false);
  useEffect(() => { setName(item.name); setEmotion(item.emotion); setTags(item.tags.join('，')); setUse(item.use); setConfirm(false); }, [item]);
  return <div className="sticker-editor">
    <h4>表情资料</h4><p>用情绪和场景告诉大肥鱼什么时候用这张图。</p>
    <label>名称<input aria-label="表情名称" maxLength={160} disabled={busy} value={name} onChange={e => setName(e.target.value)}/></label>
    <label>情绪<input aria-label="表情情绪" maxLength={80} placeholder="如：开心、疑惑、安慰" disabled={busy} value={emotion} onChange={e => setEmotion(e.target.value)}/></label>
    <label>关键词<input aria-label="表情关键词" maxLength={2000} placeholder="用逗号分隔，如：学习，加油" disabled={busy} value={tags} onChange={e => setTags(e.target.value)}/></label>
    <label>使用场景<textarea aria-label="表情使用场景" maxLength={1000} placeholder="如：答对题、完成今天的学习时庆祝" disabled={busy} value={use} onChange={e => setUse(e.target.value)}/></label>
    <button className="primary" disabled={busy || !name.trim()} onClick={() => save({ name: name.trim(), emotion, tags: [...new Set(tags.split(/[,，\n]/).map(t => t.trim()).filter(Boolean))], use })}>保存表情资料</button>
    {confirm ? <div className="sticker-delete-confirm"><p>删除后，历史聊天中的这张图也将不可用。原始文件保留。</p><button disabled={busy} onClick={remove}>确认删除表情</button><button disabled={busy} onClick={() => setConfirm(false)}>取消</button></div> : <button className="sticker-delete" disabled={busy} onClick={() => setConfirm(true)}>删除这张表情</button>}
  </div>;
}

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
    if (!state) return;
    let live = true;
    const timer = setTimeout(() => { void window.pet.stickers({ type: 'search', query, pack, offset }).then(result => {
      if (!live) return;
      if (result.ok) { setItems(result.items ?? []); setMatches(result.matches ?? 0); } else setMessage(result.message ?? '搜索失败');
    }).catch(e => { if (live) setMessage(String(e)); }); }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [query, pack, offset, state?.revision]);
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
  async function importImages() {
    setBusy(true);
    try {
      const result = await request({ type: 'import-images' });
      if (result?.ok) { setPack(localStickerPack); setQuery(''); setOffset(0); setSelected(result.items?.[0]); setImageFailed(false); setMessage(result.message ?? '图片已导入'); }
    } finally { setBusy(false); }
  }
  async function saveDetails(details: Details) {
    if (!selected) return;
    setBusy(true);
    try { const result = await request({ type: 'edit-local', id: selected.id, details }); if (result?.ok) { setSelected(result.item); setMessage(result.message ?? '已保存'); } }
    finally { setBusy(false); }
  }
  async function removeSelected() {
    if (!selected) return;
    setBusy(true);
    try { const result = await request({ type: 'delete-local', id: selected.id }); if (result?.ok) { setSelected(undefined); setOffset(0); setMessage(result.message ?? '已删除'); } }
    finally { setBusy(false); }
  }
  const link = (url: string) => { void window.pet.openChatLink(url).catch(e => setMessage(String(e))); };
  const search = (value: string) => { setQuery(value); setOffset(0); };
  if (!state) return <p role="status">正在打开表情包…{message}</p>;
  return <div className="stickers-panel">
    <section className="settings-card sticker-import"><div><h3>我的表情</h3><p>导入 PNG、JPG、WebP 或 GIF，保存在本机；给它写上情绪和场景，大肥鱼就能选用。</p><small>可多选，一次最多 50 张，每张不超过 20 MB。</small></div><div><button className="primary" disabled={busy} onClick={() => void importImages()}>{busy ? '正在处理…' : '导入图片／GIF'}</button><button disabled={busy} onClick={() => { setPack(localStickerPack); search(''); }}>查看我的表情（{state.localCount}）</button></div></section>
    <section className="settings-card sticker-settings">
      <div className="sticker-plugin-title"><div><h3>{state.plugin?.name ?? '表情包'} {state.plugin && <small>插件 {state.plugin.version}</small>}</h3><p>{state.total} 张表情 · 我的表情 {state.localCount} 张 · 下载缓存 {state.cached} 张（{(state.cacheBytes / 1024 / 1024).toFixed(1)} MB）</p></div><span className={`sticker-status ${state.settings.enabled ? 'on' : ''}`}>{state.settings.enabled ? '大肥鱼可以使用' : '仅浏览预览'}</span></div>
      <label className="toggle-row"><span><strong>允许大肥鱼使用表情包</strong><small>根据聊天内容挑选，每次回复最多一张；本地导入的图片可以直接使用。</small></span><input type="checkbox" role="switch" disabled={busy} checked={state.settings.enabled} onChange={e => void configure({ enabled: e.target.checked })}/><i/></label>
      <div className="sticker-options"><label>发送频率 <select aria-label="表情发送频率" value={state.settings.frequency} onChange={e => void configure({ frequency: e.target.value as StickerSettings['frequency'] })}><option value="rare">少量 · 有需要时</option><option value="normal">自然 · 偶尔表达</option><option value="often">活泼 · 轻松聊天多用</option><option value="always">每次回复都发送</option></select></label><label><input type="checkbox" checked={state.settings.offline} onChange={e => void configure({ offline: e.target.checked })}/>仅使用已下载表情</label></div>
      {state.settings.frequency === 'always' && <small>每次桌面聊天回复附一张表情。模型漏选时自动补选；若下载失败或没有允许使用的表情，保留文字并在这里提示。</small>}
      <div className="sticker-pack-options"><span>大肥鱼可选的套组</span>{state.packs.map(group => <label key={group.name}><input type="checkbox" checked={state.settings.packs.includes(group.name)} onChange={e => void configure({ packs: e.target.checked ? [...state.settings.packs, group.name] : state.settings.packs.filter(name => name !== group.name) })}/>{group.name}（{group.count}）</label>)}</div>
    </section>
    {(message || state.notice) && <div className="notice" role="status">{message || state.notice}</div>}
    <div className="sticker-search"><input aria-label="搜索表情" placeholder="搜索名字、情绪或场景，比如：开心、摸鱼、鼓励" value={query} onChange={e => search(e.target.value)}/><select aria-label="浏览套组" value={pack} onChange={e => { setPack(e.target.value); setOffset(0); }}><option value="">全部套组</option>{state.packs.map(group => <option key={group.name}>{group.name}</option>)}{!state.packs.some(p => p.name === localStickerPack) && <option>{localStickerPack}</option>}</select></div>
    <div className="sticker-moods">{['全部', '开心', '打招呼', '感谢', '安慰', '摸鱼', '疑惑'].map(mood => <button key={mood} className={query === (mood === '全部' ? '' : mood) ? 'active' : ''} onClick={() => search(mood === '全部' ? '' : mood)}>{mood}</button>)}</div>
    <div className="sticker-workbench"><section aria-label="表情搜索结果"><div className="sticker-results-info">找到 {matches} 张 · 本地图片直接预览，在线表情点按下载</div><div className="sticker-grid">{items.map(item => <button key={item.id} className={`sticker-tile ${selected?.id === item.id ? 'selected' : ''}`} disabled={busy} onClick={() => void preview(item)} aria-label={`预览 ${item.name}`}>
      <span className="sticker-thumbnail">{item.cached ? <img src={item.image} alt="" loading="lazy"/> : <span aria-hidden="true">◕‿◕</span>}</span><strong>{item.name}</strong><small>{item.emotion} · {item.pack}</small><span className="sticker-tile-state">{state.settings.blocked.includes(item.id) ? '已禁止自动选用' : item.local ? '本地表情' : item.cached ? '已下载' : '点按下载预览'}</span>
    </button>)}</div>{!items.length && <p className="empty">没有找到表情，试试“开心”或“摸鱼”。</p>}<div className="sticker-pages"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>上一页</button><span>{Math.floor(offset / 24) + 1} / {Math.max(1, Math.ceil(matches / 24))}</span><button disabled={offset + 24 >= matches} onClick={() => setOffset(offset + 24)}>下一页</button></div></section>
      <section className="sticker-preview settings-card" aria-label="表情预览">{selected ? <><h3>{selected.name}</h3><div className="sticker-large">{selected.cached && !imageFailed ? <img src={selected.image} alt={selected.name} onError={() => setImageFailed(true)}/> : <span>{busy ? '正在准备表情…' : imageFailed ? '图片不可用，请重试或重新导入' : '表情还没有下载成功'}</span>}</div><div className="tags"><span>{selected.emotion}</span>{selected.tags.slice(0, 5).map(tag => <span key={tag}>{tag}</span>)}</div><p>{selected.use}</p>{selected.direction && <small>{selected.direction}</small>}{!selected.local && <details><summary>画面与出处</summary><p>{selected.description}</p>{selected.meme && <p>{selected.meme}</p>}</details>}<div className="sticker-preview-actions"><button className="primary" disabled={busy} onClick={() => void preview(selected, true)}>在气泡预览</button><button disabled={busy} onClick={() => void preview(selected)}>重新加载</button></div><label className="sticker-block"><input type="checkbox" disabled={busy} checked={state.settings.blocked.includes(selected.id)} onChange={e => void configure({ blocked: e.target.checked ? [...new Set([...state.settings.blocked, selected.id])] : state.settings.blocked.filter(id => id !== selected.id) })}/>不让大肥鱼自动选用这张</label>{selected.local && <LocalStickerEditor key={selected.id} item={selected} busy={busy} save={details => void saveDetails(details)} remove={() => void removeSelected()}/>}</> : <div className="sticker-preview-empty"><span>◕‿◕</span><h3>挑一张看看</h3><p>点左侧的表情，查看动态效果和适合使用的场景。</p></div>}</section>
    </div>
    <footer className="sticker-credit"><div>{state.plugin && <><span>随附套组作者：{state.plugin.author}</span><div><button onClick={() => link(state.plugin!.authorUrl)}>作者主页 ↗</button><button onClick={() => link(state.plugin!.origin)}>素材网站 ↗</button><button onClick={() => link(state.plugin!.source)}>原插件项目 ↗</button></div><small>{state.plugin.license}</small></>}<small>“我的表情”独立保存在本机，清理下载缓存或更新插件时会保留。</small></div><div className="sticker-maintenance"><button disabled={busy} onClick={() => { setBusy(true); void request({ type: 'import-plugin' }).then(result => { if (result?.ok) { setSelected(undefined); setPack(''); search(''); setMessage(result.message ?? '插件已更新'); } }).finally(() => setBusy(false)); }}>导入／更新插件</button><button disabled={busy || !state.cached} onClick={() => { setBusy(true); void request({ type: 'clear-cache' }).then(result => { if (result?.ok) { setSelected(undefined); setMessage('已清理下载缓存，表情设置和本地图片已保留'); } }).finally(() => setBusy(false)); }}>清理下载缓存</button></div></footer>
  </div>;
}
