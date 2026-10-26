import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DiaryService } from '../src/main/diary/service';
import { appendDiary, defaultDiaryDirectory, readDiary } from '../src/main/diary/files';
import { CompanionStore } from '../src/main/companion/store';
import { diaryDay, diaryRequestSchema } from '../src/shared/diary';
import { diaryMaterial, diaryMessages } from '../src/companion/diary';
import type { CompanionEvent } from '../src/shared/companion';
import type { ModelPort } from '../src/companion/ports';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function folder() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-diary-test-')); folders.push(directory); return directory; }
const now = new Date(2026, 9, 26, 23, 59, 58).getTime();
function event(text: string, extra: Partial<CompanionEvent> = {}): CompanionEvent { return { id: text, at: now, source: 'desktop', actor: 'user', conversationId: 'desktop', text, ...extra }; }
async function fixture(model?: ModelPort) {
  const directory = await folder(), root = path.join(directory, 'project'), settings = path.join(directory, 'profile', 'diary-settings.json');
  const data = new CompanionStore(path.join(directory, 'unused'), now).data;
  data.events = [event('今天一起调好了聊天框'), event('我很开心！', { actor: 'pet' })];
  const complete = vi.fn<ModelPort['complete']>().mockResolvedValue({ text: '今天一起调好了聊天框，我好开心。', calls: [] });
  const host = { now: () => now, data: () => data, changed: vi.fn(), chooseDirectory: vi.fn(async (_current: string): Promise<string | undefined> => undefined), openDirectory: vi.fn(async (_directory: string) => {}) };
  const service = new DiaryService(settings, root, model ?? { complete }, host); await service.start();
  return { service, directory, root, settings, data, complete, host };
}

describe('日记的资料与文件边界', () => {
  it('只使用当地日期内的桌面对话，不泄露模型配置或混入旧经历、QQ、未来和系统提示', async () => {
    const { data } = await fixture();
    data.config.model.baseUrl = 'https://private-model.example';
    data.events.push(event('昨天秘密', { at: now - 86400000 }), event('明天内容', { at: now + 10000 }), event('群秘密', { source: 'qq-group' }), event('私聊秘密', { source: 'qq-private' }), event('唤醒提示', { actor: 'system', source: 'initiative' }));
    expect(diaryMaterial(data, now).events.map(e => e.text)).toEqual(['今天一起调好了聊天框', '我很开心！']);
    const messages = JSON.stringify(diaryMessages(data, now));
    for (const secret of ['昨天秘密', '明天内容', '群秘密', '私聊秘密', '唤醒提示', 'private-model.example']) expect(messages).not.toContain(secret);
    expect(diaryDay(now)).toBe('2026-10-26');
  });
  it('拒绝任意路径、非法日期和额外请求字段', () => {
    for (const date of ['../package.json', '2026-02-30', '2026-2-1', '2026-13-01']) expect(diaryRequestSchema.safeParse({ type: 'read', date }).success).toBe(false);
    expect(diaryRequestSchema.safeParse({ type: 'read', date: '2026-10-26', path: 'secret' }).success).toBe(false);
  });
  it('默认定位源码根目录；便携包及无源码安装有稳定回退，不选择 app.asar 内部', async () => {
    const root = await folder(); await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'deepblue-desktop-pet' }));
    expect(await defaultDiaryDirectory([path.join(root, 'release', 'win-unpacked')], os.tmpdir())).toBe(root);
    const standalone = await folder();
    expect(await defaultDiaryDirectory([path.join(standalone, 'resources', 'app.asar')], standalone)).toBe(standalone);
  });
  it('大文件与非普通文件不覆盖；只追加本程序的日期命名文件', async () => {
    const root = await folder(); await fs.writeFile(path.join(root, 'package.json'), '原工程文件');
    const file = path.join(root, '大肥鱼日记-2026-10-26.md'); await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    await expect(appendDiary(root, '2026-10-26', '新内容', new AbortController().signal)).rejects.toThrow('1MB');
    expect((await fs.stat(file)).size).toBe(1024 * 1024 + 1);
    await expect(readDiary(root, '../package.json')).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe('原工程文件');
  });
});

describe('写日记、改路径、取消与恢复', () => {
  it('离线可写，同一天追加；查看、打开目录和刷新都不调用模型', async () => {
    const { service, complete, root, host } = await fixture();
    const first = await service.request({ type: 'write' }); expect(first.ok).toBe(true); expect(first.state.content).toContain('本地纪事');
    const second = await service.request({ type: 'write' }); expect(second.state.content).toContain(first.state.content.trim());
    expect(second.state.content.match(/^## /gm)).toHaveLength(2);
    expect((await service.request({ type: 'read', date: '2026-10-26' })).state.content).toBe(await fs.readFile(path.join(root, '大肥鱼日记-2026-10-26.md'), 'utf8'));
    await service.request({ type: 'refresh' }); await service.request({ type: 'open-directory' });
    expect(host.openDirectory).toHaveBeenCalledWith(root); expect(complete).not.toHaveBeenCalled();
  });
  it('已配置模型时只请求一次，无工具和记忆副作用；跨午夜仍保存到点击时日期', async () => {
    const { service, data, complete, host } = await fixture(); data.config.enabled = true; data.config.model.model = 'fixture';
    const before = structuredClone(data);
    complete.mockImplementation(async () => { host.now = () => now + 10000; return { text: '```markdown\n和你一起调聊天框，今天很满足。\n```', calls: [] }; });
    const result = await service.request({ type: 'write' });
    expect(result.ok).toBe(true); expect(result.state.selectedDate).toBe('2026-10-26'); expect(result.state.content).toContain('和你一起调聊天框');
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0]).toHaveLength(3); expect(data).toEqual(before);
  });
  it('保存中文/空格路径可重启恢复；换目录和恢复默认都不搬动旧日记', async () => {
    const { service, directory, root, settings, host, complete } = await fixture();
    await service.request({ type: 'write' }); const target = path.join(directory, '新的 日记');
    expect((await service.request({ type: 'set-directory', directory: target })).ok).toBe(true);
    expect(service.view().content).toBe(''); await service.request({ type: 'write' });
    const restored = new DiaryService(settings, root, { complete }, host); await restored.start();
    expect(restored.view().directory).toBe(target); expect(restored.view().files).toHaveLength(1);
    const back = await restored.request({ type: 'set-directory', directory: '' }); expect(back.state.directory).toBe(root);
    expect(await fs.readFile(path.join(target, '大肥鱼日记-2026-10-26.md'), 'utf8')).toContain('本地纪事');
    expect(back.state.files).toHaveLength(1);
  });
  it('取消选择器或无效/不可写路径不会变更已保存的位置', async () => {
    const { service, directory, root, host } = await fixture();
    await service.request({ type: 'choose-directory' }); expect(host.chooseDirectory).toHaveBeenCalledWith(root);
    expect((await service.request({ type: 'set-directory', directory: './relative' })).ok).toBe(false);
    const file = path.join(directory, 'not-a-folder'); await fs.writeFile(file, '保留');
    expect((await service.request({ type: 'set-directory', directory: file })).ok).toBe(false); expect(service.view().directory).toBe(root);
    expect(await fs.readFile(file, 'utf8')).toBe('保留');
  });
  it('模型失败、返回空内容或工具调用不会覆盖旧日记', async () => {
    const { service, data, complete } = await fixture(); await service.request({ type: 'write' }); const original = service.view().content;
    data.config.enabled = true; data.config.model.model = 'fixture';
    complete.mockRejectedValueOnce(new Error('HTTP 401')).mockResolvedValueOnce({ text: '', calls: [] }).mockResolvedValueOnce({ text: 'ok', calls: [{ id: 'x', type: 'function', function: { name: 'shell', arguments: '{}' } }] });
    for (let i = 0; i < 3; i++) { expect((await service.request({ type: 'write' })).ok).toBe(false); expect(service.view().content).toBe(original); }
  });
  it('生成中重复点击和更改目录被阻止，取消后迟到模型结果不能落盘', async () => {
    let done!: (value: { text: string; calls: [] }) => void;
    let arrived!: () => void; const arrival = new Promise<void>(resolve => { arrived = resolve; });
    const f = await fixture({ complete: async () => { arrived(); return new Promise(resolve => { done = resolve; }); } });
    f.data.config.enabled = true; f.data.config.model.model = 'fixture';
    const writing = f.service.request({ type: 'write' }); await arrival;
    expect((await f.service.request({ type: 'write' })).ok).toBe(false);
    expect((await f.service.request({ type: 'set-directory', directory: f.directory })).ok).toBe(false);
    await f.service.request({ type: 'cancel' }); done({ text: '不应保存', calls: [] });
    expect((await writing).message).toContain('已停止'); expect(f.service.view().files).toHaveLength(0);
    expect(await fs.readdir(f.root)).toEqual([]);
  });
  it('损坏的日记设置备份恢复，不影响旧日记或陪伴配置', async () => {
    const { root, settings, host, complete } = await fixture(); await fs.mkdir(path.dirname(settings), { recursive: true });
    await fs.writeFile(settings, '{broken'); const service = new DiaryService(settings, root, { complete }, host); await service.start();
    expect(service.view().directory).toBe(root); expect(service.view().notice).toContain('备份');
    const backup = (await fs.readdir(path.dirname(settings))).find(f => f.includes('.corrupt-'))!;
    expect(await fs.readFile(path.join(path.dirname(settings), backup), 'utf8')).toBe('{broken');
  });
});
