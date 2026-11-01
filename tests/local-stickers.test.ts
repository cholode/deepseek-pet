import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { StickerService } from '../src/main/stickers/service';
import { localStickerPack, stickerImageUrl, stickerMime, stickerRequestSchema } from '../src/shared/stickers';

const roots: string[] = [], services: StickerService[] = [];
const plugin = path.resolve('plugins/nekowhale-stickers');
async function setup(missingPlugin = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-local-stickers-')); roots.push(root);
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#3288ff' } }).png().toBuffer();
  const pixels = Buffer.concat([Buffer.alloc(8 * 8 * 3, 32), Buffer.alloc(8 * 8 * 3, 240)]);
  const gif = await sharp(pixels, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } }).gif({ loop: 0, delay: [120, 120] }).toBuffer();
  const data = { png, gif, jpeg: await sharp(png).jpeg().toBuffer(), webp: await sharp(png).webp().toBuffer() };
  const files = await Promise.all(Object.entries(data).map(async ([extension, bytes]) => { const file = path.join(root, `开心.${extension}`); await fs.writeFile(file, bytes); return file; }));
  const host = { changed: vi.fn(), preview: vi.fn(), chooseImages: vi.fn(async () => files), choosePlugin: vi.fn(async () => plugin) };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('本地表情不能联网'); });
  const directory = path.join(root, 'data'), source = missingPlugin ? path.join(root, 'missing') : plugin;
  const service = new StickerService(directory, source, host, fetcher); services.push(service); await service.start();
  const configure = (patch = {}) => service.request({ type: 'configure', settings: { ...service.view().settings, ...patch } });
  return { root, files, data, host, fetcher, service, configure, directory, source };
}
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()));
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pet-local-stickers-')) throw new Error('测试清理路径无效');
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('我的表情', () => {
  it('手动发送不受自动选图开关限制，保留完整文字与图片资料，不占用大肥鱼的选图', async () => {
    const { service, configure } = await setup();
    const item = (await service.request({ type: 'import-images' })).items![0];
    await service.request({ type: 'edit-local', id: item.id, details: { name: '庆祝', emotion: '开心', tags: ['学习'], use: '完成练习' } });
    await configure({ enabled: false, packs: [], blocked: [item.id], offline: true });
    const message = await service.composeUserMessage('鱼'.repeat(4000), item.id, new AbortController().signal);
    expect(message.startsWith('鱼'.repeat(4000))).toBe(true); expect(message).toContain('情绪：开心'); expect(message).toContain('场景：完成练习'); expect(message).toContain(item.image); expect(message.length).toBeLessThan(8000);
    expect(await service.decorateReply('收到')).toBe('收到');
    await expect(service.composeUserMessage('', item.id, AbortSignal.abort())).rejects.toThrow();
    await expect(service.composeUserMessage('', 'file:///secret.png', new AbortController().signal)).rejects.toThrow('重新选择');
  });
  it('聊天选择器只开放搜索和准备图片，不允许管理资料或在气泡主动展示', async () => {
    const { service, host } = await setup(); const item = (await service.request({ type: 'import-images' })).items![0];
    expect((await service.pickerRequest({ type: 'search', query: '开心' })).ok).toBe(true);
    expect((await service.pickerRequest({ type: 'prepare', id: item.id })).item?.image).toBe(item.image);
    expect(host.preview).not.toHaveBeenCalled();
    for (const raw of [{ type: 'delete-local', id: item.id }, { type: 'import-images' }, { type: 'prepare', id: item.id, bubble: true }]) await expect(service.pickerRequest(raw)).rejects.toThrow();
  });
  it('导入四种真实图片格式、原样保留 GIF 动画，副本不依赖原文件', async () => {
    const { service, files, data, fetcher } = await setup();
    const imported = await service.request({ type: 'import-images' }); expect(imported.ok).toBe(true); expect(imported.items).toHaveLength(4);
    expect(service.view().localCount).toBe(4); expect(service.view().cached).toBe(0); expect(service.view().settings.enabled).toBe(false);
    expect(service.view().settings.packs).toContain(localStickerPack);
    const gif = imported.items!.find(item => item.image.endsWith('.gif'))!; expect(gif.frames).toBe(2); expect(await service.image(gif.image)).toEqual(data.gif);
    for (const item of imported.items!) {
      const format = item.image.split('.').at(-1)!;
      expect(stickerMime(item.image)).toBe(`image/${format}`); expect(stickerImageUrl(item.image)).toBe(true);
      expect(await service.image(item.image)).toEqual(data[format as keyof typeof data]);
    }
    for (const file of files) await fs.unlink(file);
    expect((await service.request({ type: 'preview', id: gif.id, bubble: true })).ok).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it('同图去重保留编辑信息，混合坏图报告失败但其他图片继续导入', async () => {
    const { service, host, files, root } = await setup();
    const broken = path.join(root, '坏图.gif'); await fs.writeFile(broken, '<html>this is not a GIF file</html>');
    host.chooseImages.mockResolvedValueOnce([files[0], broken]);
    const first = await service.request({ type: 'import-images' }); expect(first.ok).toBe(true); expect(first.message).toContain('1 张未导入'); expect(first.items).toHaveLength(1);
    const item = first.items![0];
    expect((await service.request({ type: 'edit-local', id: item.id, details: { name: '答对啦', emotion: '开心', tags: ['日语'], use: '学习成功时庆祝' } })).ok).toBe(true);
    host.chooseImages.mockResolvedValueOnce([files[0]]);
    const repeated = await service.request({ type: 'import-images' }); expect(repeated.message).toContain('已有 1 张'); expect(service.view().localCount).toBe(1); expect(repeated.items![0].name).toBe('答对啦');
    expect((await service.request({ type: 'search', query: '学习成功', pack: localStickerPack })).items?.[0].name).toBe('答对啦');
  });
  it('无随附插件也能离线选图，关闭或禁用后不能发送', async () => {
    const { service, configure, fetcher, host, files } = await setup(true); host.chooseImages.mockResolvedValue([files[0]]);
    const imported = await service.request({ type: 'import-images' }), item = imported.items![0]; expect(service.view().plugin).toBeNull();
    await configure({ enabled: true, offline: true, frequency: 'always', packs: [localStickerPack] });
    expect(await service.list(new AbortController().signal)).toHaveLength(2);
    expect(await service.decorateReply('开心！')).toContain(item.image); expect(fetcher).not.toHaveBeenCalled();
    await configure({ blocked: [item.id] }); service.beginTurn({ text: '下一轮' }); expect(await service.decorateReply('开心！')).toBe('开心！');
    await configure({ blocked: [], enabled: false }); expect(await service.list(new AbortController().signal)).toEqual([]);
  });
  it('重启、清理下载缓存、更新独立插件后都保留本地原图和描述', async () => {
    const { service, directory, host, fetcher, source, configure } = await setup();
    const item = (await service.request({ type: 'import-images' })).items![0];
    await service.request({ type: 'edit-local', id: item.id, details: { name: '加油', emotion: '鼓励', tags: ['学习'], use: '练习日语' } });
    await configure({ enabled: true, offline: true, blocked: [item.id] });
    await service.request({ type: 'clear-cache' }); expect(await service.image(item.image)).toBeDefined();
    await service.request({ type: 'import-plugin' }); expect(service.view().localCount).toBe(4); expect(service.view().settings.blocked).toContain(item.id);
    await service.close();
    const next = new StickerService(directory, source, host, fetcher); services.push(next); await next.start();
    expect(next.view().localCount).toBe(4); expect(next.view().settings.offline).toBe(true); expect(await next.image(item.image)).toBeDefined();
    expect((await next.request({ type: 'search', query: '练习日语', pack: localStickerPack })).items![0].name).toBe('加油');
  });
  it('删除会撤销选图与协议访问，清理套组选项，但不删除用户原文件', async () => {
    const { service, configure, host, files } = await setup(); host.chooseImages.mockResolvedValue([files[0]]);
    const item = (await service.request({ type: 'import-images' })).items![0];
    await configure({ enabled: true, packs: [localStickerPack], blocked: [item.id] });
    expect((await service.request({ type: 'delete-local', id: item.id })).ok).toBe(true);
    expect(await service.image(item.image)).toBeUndefined(); expect(service.view().settings.packs).not.toContain(localStickerPack); expect(service.view().settings.blocked).not.toContain(item.id);
    expect(service.view().localCount).toBe(0); expect(await fs.stat(files[0])).toBeDefined(); expect((await configure({ enabled: false })).ok).toBe(true);
  });
  it('IPC 不接收路径，外链及伪造协议被拒绝，取消选择不改资料', async () => {
    const { service, host } = await setup();
    expect(stickerRequestSchema.safeParse({ type: 'import-images', paths: ['C:/secret.png'] }).success).toBe(false);
    for (const value of ['file:///secret.png', 'petsticker://local/../../x.png', `petsticker://local/${'a'.repeat(64)}.svg`, `petsticker://local/${'a'.repeat(64)}.png?path=secret`]) {
      expect(stickerImageUrl(value)).toBe(false); expect(await service.image(value)).toBeUndefined();
    }
    host.chooseImages.mockResolvedValue([]); expect((await service.request({ type: 'import-images' })).ok).toBe(false); expect(service.view().localCount).toBe(0);
  });
  it('损坏副本不能发送，重新导入同一原图可以修复并保留描述', async () => {
    const { service, host, files, directory } = await setup(); host.chooseImages.mockResolvedValue([files[0]]);
    const item = (await service.request({ type: 'import-images' })).items![0];
    await service.request({ type: 'edit-local', id: item.id, details: { name: '保留名字', emotion: '', tags: [], use: '' } });
    await fs.writeFile(path.join(directory, 'local', new URL(item.image).pathname.slice(1)), 'bad');
    expect(await service.image(item.image)).toBeUndefined(); expect((await service.request({ type: 'preview', id: item.id })).ok).toBe(false);
    const repaired = await service.request({ type: 'import-images' }); expect(repaired.ok).toBe(true); expect(repaired.items![0].name).toBe('保留名字'); expect(await service.image(item.image)).toBeDefined();
  });
});
