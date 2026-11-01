import { useEffect, useId, useRef, useState } from 'react';
import type { StickerItem, StickerView } from '../../shared/stickers';
import './expressions.css';

const emojis = [
  ['😊', '微笑'], ['😄', '开心'], ['😂', '笑哭'], ['🥰', '喜欢'], ['😍', '心动'], ['😘', '亲亲'], ['😎', '得意'], ['🤗', '抱抱'],
  ['🥺', '委屈'], ['😭', '大哭'], ['😢', '难过'], ['😤', '生气'], ['😳', '害羞'], ['🤔', '思考'], ['😮', '惊讶'], ['😅', '尴尬'],
  ['😴', '困了'], ['🥱', '打哈欠'], ['🤭', '偷笑'], ['🙃', '倒脸'], ['🫠', '融化'], ['🤩', '期待'], ['🥳', '庆祝'], ['😌', '安心'],
  ['👍', '赞'], ['👎', '不赞同'], ['👏', '鼓掌'], ['🙏', '拜托'], ['👋', '挥手'], ['💪', '加油'], ['👌', '好的'], ['✌️', '胜利'],
  ['❤️', '爱心'], ['💙', '蓝心'], ['💕', '两颗心'], ['✨', '闪亮'], ['🎉', '礼花'], ['🌸', '樱花'], ['🌟', '星星'], ['💤', '睡觉'],
  ['🐟', '小鱼'], ['🐳', '鲸鱼'], ['🐱', '猫咪'], ['🐶', '狗狗'], ['☀️', '太阳'], ['🌙', '月亮'], ['☕', '咖啡'], ['🍰', '蛋糕'],
  ['📚', '学习'], ['✏️', '写字'], ['✅', '完成'], ['❓', '疑问'], ['💡', '想法'], ['🎯', '目标'], ['🔥', '热情'], ['🎵', '音乐']
];

export function ExpressionButton({ open, disabled, onClick }: { open: boolean; disabled?: boolean; onClick(): void }) {
  return <button type="button" className="expression-toggle" data-expression-toggle aria-label="选择表情" title="选择 Emoji 或表情包" aria-expanded={open} disabled={disabled}
    onMouseDown={e => e.preventDefault()} onClick={onClick}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0"/><circle cx="8.5" cy="9" r=".6" fill="currentColor"/><circle cx="15.5" cy="9" r=".6" fill="currentColor"/></svg>
  </button>;
}

export function StickerDraft({ item, remove, error }: { item: StickerItem; remove(): void; error?: string }) {
  return <div className="sticker-draft" aria-label="待发送表情"><img src={item.image} alt={item.name}/><span><strong>{item.name}</strong><small role={error ? 'status' : undefined}>{error || '随消息发送，也可单独发送'}</small></span><button type="button" aria-label="移除待发送表情" title="移除" onClick={remove}>×</button></div>;
}

export function ExpressionPicker({ onEmoji, onSticker, close }: { onEmoji(value: string): boolean; onSticker(item: StickerItem): void; close(): void }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), live = useRef(true);
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const [query, setQuery] = useState(''), [pack, setPack] = useState(''), [offset, setOffset] = useState(0);
  const [view, setView] = useState<StickerView>(), [items, setItems] = useState<StickerItem[]>([]), [matches, setMatches] = useState(0);
  const [loading, setLoading] = useState(false), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    live.current = true;
    const outside = (event: PointerEvent) => { if (event.target instanceof Element && !root.current?.contains(event.target) && !event.target.closest('[data-expression-toggle]')) closeRef.current(); };
    document.addEventListener('pointerdown', outside);
    return () => { live.current = false; document.removeEventListener('pointerdown', outside); };
  }, []);
  useEffect(() => {
    if (tab !== 'stickers') return;
    let current = true; setLoading(true); setError('');
    const timer = setTimeout(() => { void window.pet.stickerPicker({ type: 'search', query, pack, offset }).then(result => {
      if (!current) return;
      setView(result.state); setItems(result.items ?? []); setMatches(result.matches ?? 0);
      if (!result.ok) setError(result.message ?? '表情加载失败');
    }).catch(e => { if (current) setError(String(e)); }).finally(() => { if (current) setLoading(false); }); }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [tab, query, pack, offset]);
  async function choose(item: StickerItem) {
    if (preparing) return;
    setPreparing(true); setError('');
    try {
      const result = await window.pet.stickerPicker({ type: 'prepare', id: item.id });
      if (!live.current) return;
      if (result.ok && result.item) { onSticker(result.item); close(); }
      else setError(result.message ?? '图片准备失败，请重试');
    } catch (e) { if (live.current) setError(String(e)); }
    finally { if (live.current) setPreparing(false); }
  }
  return <div className="expression-picker" ref={root} role="region" aria-label="表情选择器" onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <header><div role="tablist" aria-label="表情类型">{(['emoji', 'stickers'] as const).map(value => <button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-content`} tabIndex={tab === value ? 0 : -1} disabled={preparing}
      onClick={() => { setTab(value); setError(''); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'emoji' : e.key === 'End' ? 'stickers' : value === 'emoji' ? 'stickers' : 'emoji'; setTab(next); document.getElementById(`${id}-${next}`)?.focus(); } }}>{value === 'emoji' ? 'Emoji' : '表情包'}</button>)}</div><button className="expression-close" type="button" aria-label="关闭表情选择器" onClick={close}>×</button></header>
    <div id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="expression-content">
      {tab === 'emoji' ? <div className="emoji-grid">{emojis.map(([value, name]) => <button type="button" key={name} aria-label={`${name} ${value}`} title={name} onMouseDown={e => e.preventDefault()} onClick={() => { if (!onEmoji(value)) setError('文字已达到 4000 字上限，请先删减一些内容'); }}>{value}</button>)}</div> : <>
        <div className="expression-search"><input aria-label="搜索可发送的表情" placeholder="搜索表情、情绪…" maxLength={200} value={query} disabled={preparing} onChange={e => { setQuery(e.target.value); setOffset(0); }}/><select aria-label="选择表情套组" value={pack} disabled={preparing} onChange={e => { setPack(e.target.value); setOffset(0); }}><option value="">全部套组</option>{view?.packs.map(group => <option key={group.name}>{group.name}</option>)}</select></div>
        <div className="expression-stickers" aria-busy={loading || preparing}>{items.map(item => <button key={item.id} type="button" title={item.name} aria-label={`选择表情 ${item.name}`} disabled={loading || preparing} onClick={() => void choose(item)}>{item.cached ? <img src={item.image} alt="" loading="lazy"/> : <span aria-hidden="true">◕‿◕</span>}<small>{item.name}</small>{!item.cached && <em>点击加载</em>}</button>)}{!items.length && <p>{loading ? '正在加载…' : '没有找到，可到小屋「表情包」导入自己的图片。'}</p>}</div>
        <footer><button type="button" disabled={preparing || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>上一页</button><span>{Math.floor(offset / 24) + 1} / {Math.max(1, Math.ceil(matches / 24))}</span><button type="button" disabled={preparing || loading || offset + 24 >= matches} onClick={() => setOffset(offset + 24)}>下一页</button></footer>
      </>}
    </div>
    {(error || preparing) && <p className="expression-feedback" role="status">{error || '正在准备表情…'}</p>}
  </div>;
}
