import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StickerService } from '../src/main/stickers/service';
import { readStickerPlugin, installStickerPlugin } from '../src/main/stickers/plugin';
import { imageUrl, searchStickers } from '../src/main/stickers/catalog';
import { stickerImageUrl } from '../src/shared/stickers';
import { MarkdownContent } from '../src/renderer/chat/MarkdownContent';
import { ToolRouter } from '../src/companion/tool-router';
import { CompanionCoordinator } from '../src/companion/coordinator';
import { fixture } from './companion-fixture';

const roots: string[] = [], services: StickerService[] = [];
const data = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const source = path.resolve('plugins/nekowhale-stickers');
const signal = () => new AbortController().signal;
async function setup(fetcher: typeof fetch = vi.fn(async () => new Response(data))) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-stickers-')); roots.push(root);
  const plugin = path.join(root, 'source'); await fs.mkdir(plugin);
  for (const file of ['sticker-plugin.json', 'NOTICE', 'LICENSE', 'LICENSE-ASSETS']) await fs.copyFile(path.join(source, file), path.join(plugin, file));
  const base = (await readStickerPlugin(source)).catalog.items[0];
  const item = { ...base, id: '大肥鱼/测试开心', name: '开心猫', bytes: data.length, width: 1, height: 1, frames: 1, hash: createHash('sha1').update(data).digest('hex').slice(0, 12), emotion: '开心', tags: ['鼓励', '期待'] };
  const other = { ...item, id: '大肥鱼/测试摸鱼', name: '摸鱼猫', url: 'https://kiriyuki.com/second.gif', emotion: '疲惫', tags: ['摸鱼', '上班'] };
  await fs.writeFile(path.join(plugin, 'catalog.json'), JSON.stringify({ updated: 'fixture', items: [item, other] }));
  const host = { changed: vi.fn(), preview: vi.fn(), choosePlugin: vi.fn(async () => plugin) };
  const service = new StickerService(path.join(root, 'data'), plugin, host, fetcher); services.push(service); await service.start();
  const configure = (patch = {}) => service.request({ type: 'configure', settings: { ...service.view().settings, ...patch } });
  return { root, plugin, service, host, item, other, configure, fetcher };
}
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('表情插件与缓存', () => {
  it('纯问候重置上一轮选择，直接复用可用缓存而不下载新图', async () => {
    const { service, configure, fetcher, item, other } = await setup();
    await configure({ enabled: true, frequency: 'always' });
    await service.cache.ensure(other, false, signal());
    service.beginTurn({ text: '上午好' });
    expect(await service.decorateReply('开心，今天也一起加油。')).toContain(imageUrl(other)); expect(fetcher).toHaveBeenCalledTimes(1);
    await configure({ blocked: [other.id] }); service.beginTurn({ text: '你好' });
    expect(await service.decorateReply('开心。')).toContain(imageUrl(item)); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('322 张真实目录离线加载，默认不提供工具或下载', async () => {
    const { catalog, manifest } = await readStickerPlugin(source);
    expect(catalog.items).toHaveLength(322); expect(manifest.version).toBe('1.0.0');
    expect(searchStickers(catalog.items, '想摸鱼').length).toBeGreaterThan(0);
    const { service, fetcher } = await setup();
    expect(await service.list(signal())).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
    expect((await service.request({ type: 'search', query: '开心' })).items?.[0].name).toBe('开心猫');
  });
  it('工具选择实际下载的 GIF，校验后附在回复并限制每轮一张', async () => {
    const { service, fetcher, configure, item, other } = await setup();
    await configure({ enabled: true }); expect(await service.list(signal())).toHaveLength(2);
    await service.call('dafeiyu_sticker_send', { id: item.id }, signal());
    expect(fetcher).toHaveBeenCalledWith(item.url, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
    expect(await service.image(imageUrl(item))).toEqual(data);
    await service.call('dafeiyu_sticker_send', { id: other.id }, signal()); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await service.decorateReply('做得好！')).toContain(imageUrl(item));
    expect((await service.decorateReply('做得好！')).match(/!\[/g)).toHaveLength(1);
    await service.list(signal()); expect(await service.decorateReply('下一轮')).toBe('下一轮');
  });
  it('离线复用缓存，未知地址和路径不能触发读取或网络', async () => {
    const { service, fetcher, configure, item, other } = await setup();
    expect((await service.request({ type: 'preview', id: item.id })).ok).toBe(true);
    await configure({ offline: true, enabled: true });
    expect((await service.request({ type: 'preview', id: item.id })).ok).toBe(true);
    expect((await service.request({ type: 'preview', id: other.id })).ok).toBe(false);
    expect(await service.image('file:///C:/secret')).toBeUndefined();
    expect(await service.image('petsticker://local/../../secret.gif')).toBeUndefined();
    expect(await service.image(`petsticker://local/${'f'.repeat(64)}.gif`)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('包选择、禁用、关闭在调用时生效，手动预览不伪造聊天记录', async () => {
    const { service, configure, item, host } = await setup();
    await configure({ enabled: true }); await service.list(signal());
    await configure({ blocked: [item.id] });
    await expect(service.call('dafeiyu_sticker_send', { id: item.id }, signal())).rejects.toThrow('禁用');
    expect((await service.request({ type: 'preview', id: item.id, bubble: true })).ok).toBe(true); expect(host.preview).toHaveBeenCalledTimes(1);
    await configure({ packs: [] }); expect(await service.list(signal())).toEqual([]);
    await configure({ enabled: false }); await expect(service.call('dafeiyu_sticker_search', { query: '开心' }, signal())).rejects.toThrow('关闭');
  });
  it.each(['HTML', 'wrong hash', 'oversized'])('拒绝下载 %s，失败不会附表情', async kind => {
    const bad = kind === 'HTML' ? Buffer.from('<html>not a GIF</html>') : kind === 'oversized' ? Buffer.alloc(data.length + 10) : Buffer.from(data);
    if (kind === 'wrong hash') bad[13] ^= 1;
    const { service, configure, item } = await setup(vi.fn(async () => new Response(bad)));
    await configure({ enabled: true }); await service.list(signal());
    await expect(service.call('dafeiyu_sticker_send', { id: item.id }, signal())).rejects.toThrow();
    expect(service.view().cached).toBe(0); expect(await service.decorateReply('文字')).toBe('文字');
  });
  it('撤回使用权限时中止下载，迟到返回不展示', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => { await pending; return new Response(data); });
    const { service, configure, item } = await setup(fetcher);
    await configure({ enabled: true }); await service.list(signal());
    const result = service.call('dafeiyu_sticker_send', { id: item.id }, signal()).catch(e => e);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); await configure({ enabled: false }); release();
    expect(await result).toBeInstanceOf(Error); expect(await service.decorateReply('文字')).toBe('文字'); expect(service.view().cached).toBe(0);
  });
  it('用户取消工具后不附图，下一轮可重试', async () => {
    const { service, configure, item } = await setup(); await configure({ enabled: true });
    const controller = new AbortController(); controller.abort();
    await expect(service.call('dafeiyu_sticker_send', { id: item.id }, controller.signal)).rejects.toThrow();
    expect(await service.decorateReply('文字')).toBe('文字');
    await service.call('dafeiyu_sticker_send', { id: item.id }, signal()); expect(service.view().cached).toBe(1);
  });
  it('独立导入仅复制目录与许可，重启保留设置/缓存且不执行脚本', async () => {
    const { service, configure, item, root, plugin, host, fetcher } = await setup();
    await fs.writeFile(path.join(plugin, 'run-me.mjs'), 'throw new Error("must never run")');
    const manifest = JSON.parse(await fs.readFile(path.join(plugin, 'sticker-plugin.json'), 'utf8')); manifest.version = '1.0.1'; await fs.writeFile(path.join(plugin, 'sticker-plugin.json'), JSON.stringify(manifest));
    expect((await service.request({ type: 'import-plugin' })).ok).toBe(true); expect(service.view().plugin?.version).toBe('1.0.1');
    expect(await fs.readdir(path.join(root, 'data/plugin'))).not.toContain('run-me.mjs');
    await service.request({ type: 'preview', id: item.id }); await configure({ enabled: true, offline: true }); await service.close();
    const next = new StickerService(path.join(root, 'data'), source, host, fetcher); services.push(next); await next.start();
    expect(next.view().plugin?.version).toBe('1.0.1'); expect(next.view().settings.enabled).toBe(true); expect(await next.image(imageUrl(item))).toEqual(data);
    expect((await next.request({ type: 'clear-cache' })).ok).toBe(true); expect(next.view().cached).toBe(0); expect(next.view().settings.enabled).toBe(true);
    expect(await next.image(imageUrl(item))).toBeUndefined();
  });
  it('坏插件不替换现有版本；跨来源图像被拒绝', async () => {
    const { root, plugin } = await setup(); await installStickerPlugin(plugin, path.join(root, 'data'));
    const file = path.join(plugin, 'catalog.json'), catalog = JSON.parse(await fs.readFile(file, 'utf8')); catalog.items[0].url = 'https://other.example/image.gif'; await fs.writeFile(file, JSON.stringify(catalog));
    await expect(installStickerPlugin(plugin, path.join(root, 'data'))).rejects.toThrow('来源');
    expect((await readStickerPlugin(path.join(root, 'data/plugin'))).manifest.version).toBe('1.0.0');
  });
  it('损坏缓存不能当作图片返回，联网时可重新下载', async () => {
    const { service, item, root, fetcher } = await setup(); await service.request({ type: 'preview', id: item.id });
    const file = new URL(imageUrl(item)).pathname.slice(1); await fs.writeFile(path.join(root, 'data/cache', file), '<html>bad</html>');
    expect(await service.image(imageUrl(item))).toBeUndefined();
    expect((await service.request({ type: 'preview', id: item.id })).ok).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('只有目录协议图片渲染，其他图片、脚本和伪造协议被阻止', () => {
    const url = `petsticker://local/${'a'.repeat(64)}.gif`;
    expect(stickerImageUrl(url)).toBe(true); expect(stickerImageUrl(url + '?file=C:/secret')).toBe(false);
    const html = renderToStaticMarkup(createElement(MarkdownContent, { text: `![开心](${url})\n\n![远程](https://evil.example/a.gif)\n\n![本机](file:///secret)\n\n<script>alert(1)</script>` }));
    expect(html.match(/<img /g)).toHaveLength(1); expect(html).toContain(url); expect(html).not.toContain('src="https:'); expect(html).not.toContain('<script');
  });
  it('模型两轮选表情后自动保存实际图片，外部渠道不可调用', async () => {
    const { service, configure, item } = await setup(); await configure({ enabled: true });
    const f = fixture(); f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    const router = new ToolRouter([service]); const coordinator = new CompanionCoordinator(f.repository, f.model, f.tools, f.host, router);
    const call = (name: string, args: object) => ({ text: '', calls: [{ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
    f.model.complete.mockResolvedValueOnce(call('dafeiyu_sticker_search', { query: '开心' })).mockResolvedValueOnce(call('dafeiyu_sticker_send', { id: item.id })).mockResolvedValueOnce({ text: '替你开心！', calls: [] });
    const reply = await coordinator.chat('发个开心的表情'); expect(reply).toContain(imageUrl(item)); expect(f.data.events.at(-1)?.text).toBe(reply);
    f.model.complete.mockResolvedValueOnce({ text: '普通回复', calls: [] }); await coordinator.chat('消息', 'qq-private', 'external', 'qq:1');
    expect(f.model.complete.mock.calls.at(-1)?.[3]).toEqual([]); expect(f.data.events.at(-1)?.text).toBe('普通回复');
  });
  it('路由不向未知工具转发，关闭清理全部端口', async () => {
    const { service } = await setup(); const router = new ToolRouter([service]); await router.list(signal());
    await expect(router.call('dafeiyu_sticker_send', {}, signal())).rejects.toThrow('未启用');
    await router.close();
  });
  it('每次回复模式为漏选的模型补一张，跨轮不复用选择且禁用时停止', async () => {
    const { service, configure } = await setup(); await configure({ enabled: true, frequency: 'always' });
    const f = fixture(); f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    const coordinator = new CompanionCoordinator(f.repository, f.model, f.tools, f.host, new ToolRouter([service]));
    for (let i = 0; i < 2; i++) { f.model.complete.mockResolvedValueOnce({ text: '今天也陪你聊天。', calls: [] }); const reply = await coordinator.chat(`聊天${i}`); expect(reply.match(/!\[/g)).toHaveLength(1); }
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    await configure({ enabled: false }); f.model.complete.mockResolvedValueOnce({ text: '关闭后继续。', calls: [] }); expect(await coordinator.chat('继续')).toBe('关闭后继续。');
  });
  it('每次回复遵守离线与单张禁用，无可用图时保留正文并提示', async () => {
    const { service, configure, item, fetcher } = await setup(); await configure({ enabled: true, frequency: 'always', offline: true });
    await service.list(signal()); expect(await service.decorateReply('你好')).toBe('你好'); expect(fetcher).not.toHaveBeenCalled(); expect(service.view().notice).toContain('没有可用表情');
    await configure({ offline: false }); await service.request({ type: 'preview', id: item.id });
    await configure({ offline: true, blocked: [item.id] }); await service.list(signal()); expect(await service.decorateReply('开心')).toBe('开心');
  });
  it('长中日回复附图后保留完整图片与语言元数据，不朗读被裁掉的正文', async () => {
    const { service, configure, item } = await setup(); await configure({ enabled: true, frequency: 'always' });
    const f = fixture(); f.host.speechLanguages = () => true; f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    const coordinator = new CompanionCoordinator(f.repository, f.model, f.tools, f.host, new ToolRouter([service]));
    f.model.complete.mockResolvedValueOnce({ text: `<voice lang="ja">${'先生'.repeat(3995)}</voice>`, calls: [] });
    const reply = await coordinator.chat('练习'); expect(reply.length).toBeLessThanOrEqual(8000); expect(reply).toContain(imageUrl(item));
    const event = f.data.events.at(-1)!; expect(event.speechSegments?.map(s => s.text).join('')).toBe(reply); expect(event.speechSegments?.[0].language).toBe('ja');
  });
  it('自动补表情等待时取消，迟到结果不会保存为完成回复', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')))));
    const { service, configure } = await setup(fetcher); await configure({ enabled: true, frequency: 'always' });
    const f = fixture(); f.data.config.mood.enabled = false; f.data.config.memory.automatic = false; f.model.complete.mockResolvedValueOnce({ text: '你好', calls: [] });
    const coordinator = new CompanionCoordinator(f.repository, f.model, f.tools, f.host, new ToolRouter([service]));
    const pending = coordinator.chat('你好'); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); coordinator.cancel(); expect(await pending).toBe(''); expect(f.data.events.some(e => e.actor === 'pet')).toBe(false);
  });
});
