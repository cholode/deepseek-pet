import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '../src/renderer/chat/MarkdownContent';
import { chatLink } from '../src/shared/chat-link';

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownContent, { text }));
describe('聊天 Markdown', () => {
  it('渲染标题、强调、列表、引用、代码块与 GFM 表格', () => {
    const html = render('# 日语\n\n**猫**与*ねこ*，~~旧内容~~。\n\n1. 第一项\n2. 第二项\n\n> 回忆后再看答案\n\n`猫`\n\n```js\nconst word = "猫";\n```\n\n| 单词 | 读音 |\n| --- | --- |\n| 猫 | ねこ |\n\n- [x] 已学');
    for (const tag of ['h1', 'strong', 'em', 'del', 'ol', 'blockquote', 'pre', 'table', 'thead', 'tbody']) expect(html).toContain(`<${tag}`);
    expect(html).toContain('language-js'); expect(html).toContain('type="checkbox"'); expect(html).toContain('disabled');
  });
  it('未完成的流式 Markdown 仍能显示文字，闭合后正常格式化', () => {
    expect(render('开头\n\n```js\nconst word =')).toContain('const word =');
    expect(render('**正在生成')).toContain('正在生成');
    expect(render('**正在生成**')).toContain('<strong>正在生成</strong>');
  });
  it('原始 HTML 不执行，图片不自动请求，危险链接不产生可点击地址', () => {
    const html = render('<script>alert(1)</script>\n\n<img src="file:///secret" onerror="alert(1)">\n\n![图片说明](https://example.com/track.png)\n\n[危险](javascript:alert%281%29) [本机](file:///C:/secret) [网页](https://example.com/)');
    expect(html).not.toMatch(/<(script|img|iframe)\b/); expect(html).not.toContain('onerror'); expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('file:///');
    expect(html).toContain('[图片：图片说明]'); expect(html).toContain('href="https://example.com/"');
  });
  it.each(['javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'data:text/html,test', 'ms-settings:privacy', '//example.com', '/relative', 'https://user:password@example.com', 'https://example.com\n', 'https://example.com/ a', '', null])('拒绝非网页或异常地址 %s', raw => {
    expect(chatLink(raw)).toBeUndefined();
  });
  it('允许普通网页并规范化日文地址', () => {
    expect(chatLink('https://example.com/日本語?q=猫')).toBe(new URL('https://example.com/日本語?q=猫').href);
    expect(chatLink('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765/');
  });
});
