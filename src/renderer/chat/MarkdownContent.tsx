import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatLink } from '../../shared/chat-link';
import './markdown.css';

const components: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith('#')) return <a href={href}>{children}</a>;
    const url = chatLink(href);
    return url ? <a href={url} title={url} onClick={e => { e.preventDefault(); void window.pet.openChatLink(url).catch(() => {}); }}>{children}</a> : <span>{children}</span>;
  },
  // 图片只显示替代文字，不触发网络或本机文件读取。
  img: ({ alt }) => <span className="markdown-image">[图片：{alt || '未提供说明'}]</span>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0} aria-label="代码块，可横向滚动">{children}</pre>
};

export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{text}</Markdown></div>;
});
