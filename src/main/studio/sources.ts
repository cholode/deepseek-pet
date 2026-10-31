import { promises as fs } from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { DOMParser, parseHTML } from 'linkedom';
import { unzipSync, strFromU8 } from 'fflate';
import type { StudySource } from '../../shared/studio';

export interface Download { bytes: Uint8Array; type: string; url: string }
const maximum = 16 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return ![0, 10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113) && !(a === 172 && b >= 16 && b <= 31) && !(a === 100 && b >= 64 && b <= 127) && a < 224;
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
// 网页工具不能借“教材 URL”访问本机服务。先解析并检查所有地址，再把连接固定到检查过的 IP；
// 每次重定向重新验证，避免 DNS 重绑定或跳转到局域网。这里不携带模型/语音密钥。
export async function downloadPublic(raw: string, signal: AbortSignal, redirects = 0): Promise<Download> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('资料链接须为不含账号密码的公开 HTTPS 地址');
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('资料工具不能访问本机、局域网或保留地址');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, headers: { 'User-Agent': 'DaFeiYu-Learning/1.5', Accept: 'text/html,application/pdf,application/rss+xml,text/plain', 'Accept-Encoding': 'identity' }, lookup: (_host, options, callback) => {
      if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
    } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume(); if (redirects >= 3) { reject(new Error('资料链接重定向过多')); return; }
        void downloadPublic(new URL(response.headers.location, url).href, signal, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`资料网站返回 HTTP ${response.statusCode}`)); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maximum) response.destroy(new Error('资料超过 16 MiB，请使用本地导入')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] ?? ''), url: url.href }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('读取资料超时'))); req.on('error', reject); req.end();
  });
}
export function htmlText(html: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  document.querySelectorAll('script,style,nav,footer,header,noscript,iframe,form').forEach(n => n.remove());
  document.querySelectorAll('p,div,br,h1,h2,h3,h4,li,tr,section').forEach(n => n.appendChild(document.createTextNode('\n')));
  return { title: document.querySelector('title')?.textContent?.trim() || '', text: (document.querySelector('main,article') ?? document.body ?? document.documentElement).textContent?.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim() ?? '' };
}
export class SourceReader {
  constructor(private download: typeof downloadPublic = downloadPublic) {}
  async search(query: string, signal: AbortSignal) {
    const url = new URL('https://www.bing.com/search'); url.searchParams.set('format', 'rss'); url.searchParams.set('q', query);
    const result = await this.download(url.href, signal); const xml = new DOMParser().parseFromString(new TextDecoder().decode(result.bytes), 'text/xml');
    const items = [...xml.querySelectorAll('item')].map(item => ({ title: (item.querySelector('title')?.textContent ?? '').slice(0, 200), url: item.querySelector('link')?.textContent ?? '', snippet: (item.querySelector('description')?.textContent ?? '').slice(0, 1500) })).filter(i => i.title && /^https:\/\//.test(i.url)).slice(0, 10);
    if (!items.length) throw new Error('搜索服务没有返回可读取的资料。可添加教材网址或导入本地教材后重试，不能据此编造检索结果');
    return items;
  }
  async web(courseId: string, raw: string, signal: AbortSignal): Promise<StudySource> {
    const response = await this.download(raw, signal);
    const pages = response.type.includes('pdf') || new TextDecoder().decode(response.bytes.slice(0, 5)) === '%PDF-' ? await this.pdf(response.bytes, signal) : [{ page: 1, text: (response.type.includes('text/plain') ? new TextDecoder().decode(response.bytes) : htmlText(new TextDecoder().decode(response.bytes)).text).slice(0, 60000) }];
    const title = response.type.includes('pdf') ? decodeURIComponent(new URL(response.url).pathname.split('/').pop() || '网页 PDF') : htmlText(new TextDecoder().decode(response.bytes)).title || new URL(response.url).hostname;
    return this.source(courseId, title, response.url, 'web', pages);
  }
  async file(courseId: string, file: string, signal: AbortSignal): Promise<StudySource> {
    const stat = await fs.stat(file); if (!stat.isFile() || stat.size > maximum) throw new Error('请选择 16 MiB 以内的教材文件');
    const bytes = new Uint8Array(await fs.readFile(file)); signal.throwIfAborted();
    const extension = path.extname(file).toLowerCase(); let pages: StudySource['pages'];
    if (extension === '.pdf') pages = await this.pdf(bytes, signal);
    else if (extension === '.epub') {
      let total = 0; const zip = unzipSync(bytes, { filter: item => { total += item.originalSize; if (total > 32 * 1024 * 1024) throw new Error('EPUB 解压内容过大'); return /\.(?:x?html?|opf|xml)$/i.test(item.name); } });
      const container = new DOMParser().parseFromString(strFromU8(zip['META-INF/container.xml'] ?? new Uint8Array()), 'text/xml');
      const opfPath = container.querySelector('rootfile')?.getAttribute('full-path'); if (!opfPath || !zip[opfPath]) throw new Error('EPUB 缺少书籍目录');
      const opf = new DOMParser().parseFromString(strFromU8(zip[opfPath]), 'text/xml');
      const manifest = new Map([...opf.querySelectorAll('manifest > item')].map(i => [i.getAttribute('id'), i.getAttribute('href')]));
      pages = [...opf.querySelectorAll('spine > itemref')].map((item, index) => { const href = manifest.get(item.getAttribute('idref')); const entry = href && zip[path.posix.join(path.posix.dirname(opfPath), decodeURIComponent(href.split('#')[0]))]; return { page: index + 1, text: entry ? htmlText(strFromU8(entry)).text.slice(0, 60000) : '' }; });
    } else if (['.txt', '.md', '.html', '.htm'].includes(extension)) {
      const text = /html?/.test(extension) ? htmlText(new TextDecoder().decode(bytes)).text : new TextDecoder().decode(bytes);
      pages = Array.from({ length: Math.ceil(text.length / 30000) }, (_, i) => ({ page: i + 1, text: text.slice(i * 30000, (i + 1) * 30000) }));
    } else throw new Error('支持 PDF、EPUB、TXT、Markdown 和 HTML 文件');
    return this.source(courseId, path.basename(file), file, 'file', pages);
  }
  note(courseId: string, title: string, text: string) { return this.source(courseId, title, '用户提供的学习资料', 'note', Array.from({ length: Math.ceil(text.length / 30000) }, (_, i) => ({ page: i + 1, text: text.slice(i * 30000, (i + 1) * 30000) }))); }
  private source(courseId: string, title: string, location: string, kind: StudySource['kind'], pages: StudySource['pages']): StudySource {
    const readable = pages.filter(p => p.text.trim()); if (readable.reduce((n, p) => n + p.text.trim().length, 0) < 20) throw new Error('没有提取到可阅读文字。扫描件需要先 OCR；请导入带文字层的教材，或粘贴对应内容');
    if (pages.length > 1000) throw new Error('教材超过 1000 页，请按章节导入');
    return { id: randomUUID(), courseId, title: title.slice(0, 200), location, kind, pages: readable, at: Date.now(), hash: createHash('sha256').update(JSON.stringify(readable)).digest('hex'), ...(readable.length !== pages.length ? { warning: '部分页面没有文字层，尚未进入教学资料' } : {}) };
  }
  private async pdf(bytes: Uint8Array, signal: AbortSignal) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
    const abort = () => { void task.destroy(); }; signal.addEventListener('abort', abort, { once: true });
    try {
      const document = await task.promise; if (document.numPages > 1000) throw new Error('教材超过 1000 页');
      const pages = [];
      for (let n = 1; n <= document.numPages; n++) { signal.throwIfAborted(); const page = await document.getPage(n); const content = await page.getTextContent(); pages.push({ page: n, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').slice(0, 60000) }); page.cleanup(); }
      return pages;
    } finally { signal.removeEventListener('abort', abort); await task.destroy(); }
  }
}
