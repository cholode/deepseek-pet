import { memo, useState } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatLink } from '../../shared/chat-link';
import { stickerImageUrl } from '../../shared/stickers';
import './markdown.css';

function StickerImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  return stickerImageUrl(src) && !failed
    ? <img className="chat-sticker" src={src} alt={alt || '表情包'} title={alt || '表情包'} onError={() => setFailed(true)} draggable={false}/>
    : <span className="markdown-image">[{failed ? '表情未缓存，可在小屋重新预览下载' : `图片：${alt || '未提供说明'}`}]</span>;
}
const components: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith('#')) return <a href={href}>{children}</a>;
    const url = chatLink(href);
    return url ? <a href={url} title={url} onClick={e => { e.preventDefault(); void window.pet.openChatLink(url).catch(() => {}); }}>{children}</a> : <span>{children}</span>;
  },
  // 仅显示已校验、已缓存的表情；普通 Markdown 图片仍不触发网络或本机文件读取。
  img: ({ src, alt }) => <StickerImage key={src} src={src} alt={alt}/>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0} aria-label="代码块，可横向滚动">{children}</pre>
};

export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url, key) => key === 'src' && stickerImageUrl(url) ? url : defaultUrlTransform(url)} skipHtml>{text}</Markdown></div>;
});
