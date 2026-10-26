import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CompanionStore } from '../src/main/companion/store';
import { CompatibleModel } from '../src/main/companion/model';
import { OneBotChannel } from '../src/main/companion/qq';
import { McpTools } from '../src/main/companion/mcp';
import { endpoint, readJson } from '../src/main/companion/http';
import { companionDefaults } from '../src/shared/companion';
import { memory } from './companion-fixture';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function server(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  const http = createServer((req, res) => { void handler(req, res).catch(() => { res.writeHead(500).end(); }); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => { http.closeAllConnections(); http.close(e => e ? reject(e) : resolve()); }));
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}
async function body(req: IncomingMessage) { const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(parts).toString()); }
function json(res: ServerResponse, data: unknown) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); }
async function directory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-companion-test-')); cleanups.push(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

describe('持久化与 HTTP 边界', () => {
  it('排队保存保留最终状态，重启可恢复', async () => {
    const file = path.join(await directory(), 'companion.json'); const store = new CompanionStore(file); await store.load();
    store.data.memories.push(memory()); const first = store.save();
    store.data.config.persona.userName = '测试主人'; const last = store.save(); await Promise.all([first, last]);
    const next = new CompanionStore(file); await next.load();
    expect(next.data.memories).toHaveLength(1); expect(next.data.config.persona.userName).toBe('测试主人');
  });
  it('损坏文件先备份，不覆盖无法解析的原始数据', async () => {
    const dir = await directory(); const file = path.join(dir, 'companion.json'); await fs.writeFile(file, '{broken');
    const store = new CompanionStore(file); await store.load();
    const backup = (await fs.readdir(dir)).find(n => n.includes('.corrupt-'))!;
    expect(await fs.readFile(path.join(dir, backup), 'utf8')).toBe('{broken'); expect(store.warning).toContain('备份');
    expect(store.data.config.enabled).toBe(false);
  });
  it('合法的一万条中文记忆超过旧的 16MB 限制仍可重启恢复', async () => {
    const file = path.join(await directory(), 'companion.json'); const store = new CompanionStore(file); await store.load();
    store.data.memories = Array.from({ length: 10000 }, (_, i) => memory({ id: `memory-${i}`, text: '鱼'.repeat(300), evidence: '鱼'.repeat(300) }));
    await store.save(); expect((await fs.stat(file)).size).toBeGreaterThan(16000000);
    const restored = new CompanionStore(file); await restored.load();
    expect(restored.data.memories).toHaveLength(10000); expect(restored.warning).toBeUndefined();
  });
  it('外网只允许 HTTPS，QQ 限定本机，拒绝 URL 内凭证', () => {
    expect(endpoint('http://127.0.0.1:1234').hostname).toBe('127.0.0.1');
    for (const address of ['http://example.com', 'https://u:secret@example.com', 'file:///C:/x', 'https://example.com?token=a']) expect(() => endpoint(address)).toThrow();
    expect(() => endpoint('https://example.com', true)).toThrow('本机');
  });
  it('截断过大响应，错误信息不带回服务端密钥正文', async () => {
    await expect(readJson(new Response('secret-key', { status: 401 }))).rejects.toThrow('HTTP 401');
    await expect(readJson(new Response(' '.repeat(101)), 100)).rejects.toThrow('大小限制');
  });
});
describe('真实本机 HTTP 模型与 QQ 协议', () => {
  it('模型正确发送身份头、上下文及工具参数并解析 function calling', async () => {
    const seen: unknown[] = [];
    const url = await server(async (req, res) => { seen.push({ path: req.url, token: req.headers.authorization, body: await body(req) }); json(res, { choices: [{ message: { content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'read_game', arguments: '{}' } }] } }] }); });
    const result = await new CompatibleModel(() => 'fixture-secret').complete([{ role: 'user', content: '看看游戏' }], { ...companionDefaults.model, baseUrl: `${url}/v1`, model: 'fixture' }, new AbortController().signal, [{ name: 'read_game', description: '读状态', inputSchema: { type: 'object' } }]);
    expect(result.calls[0].function.name).toBe('read_game');
    expect(seen[0]).toMatchObject({ path: '/v1/chat/completions', token: 'Bearer fixture-secret', body: { model: 'fixture', stream: false, tool_choice: 'auto' } });
  });
  it('模型请求在取消后中止等待', async () => {
    let arrived!: () => void; const arrival = new Promise<void>(r => { arrived = r; });
    const url = await server(async () => { arrived(); }); const controller = new AbortController();
    const request = new CompatibleModel(() => '').complete([], { ...companionDefaults.model, baseUrl: url, model: 'fixture' }, controller.signal);
    const rejection = expect(request).rejects.toThrow(); await arrival; controller.abort(); await rejection;
  });
  it('QQ 只读取绑定用户的定向文字，发送 CQ 内容仍为普通文字', async () => {
    const sent: unknown[] = [];
    const url = await server(async (req, res) => {
      const input = await body(req);
      if (req.url === '/get_login_info') json(res, { retcode: 0, data: { user_id: 100 } });
      else if (req.url === '/get_group_msg_history') json(res, { retcode: 0, data: { messages: [
        { message_id: 1, user_id: 200, time: 100, message: '[CQ:at,qq=100] 大肥鱼你好' },
        { message_id: 2, user_id: 300, time: 100, message: '大肥鱼，不是绑定用户' },
        { message_id: 3, user_id: 200, time: 100, message: '普通群聊不回复' },
        { message_id: 4, user_id: 100, time: 100, message: '机器人自己的消息' },
        { message_id: 5, user_id: 200, time: 10, message: '大肥鱼过期消息' },
        { message_id: 6, user_id: 200, time: 100, message: [{ type: 'at', data: { qq: '100' } }, { type: 'text', data: { text: '请看这里' } }] }
      ] } });
      else { sent.push(input); json(res, { retcode: 0, data: { message_id: 9 } }); }
    });
    const qq = new OneBotChannel(() => ({ ...companionDefaults.qq, enabled: true, baseUrl: url, kind: 'group', targetId: '1000', ownerId: '200' }), () => 'token');
    expect((await qq.poll(90000, new AbortController().signal)).map(m => m.id)).toEqual(['qq:group:1000:1', 'qq:group:1000:6']);
    await qq.send('[CQ:image,file=secret]', new AbortController().signal);
    expect(sent[0]).toMatchObject({ group_id: '1000', message: [{ type: 'text', data: { text: '[CQ:image,file=secret]' } }] });
  });
});
describe('MCP 官方 SDK 的真实客户端 / 服务端握手', () => {
  it('发现、白名单调用、撤销授权和关闭连接', async () => {
    const invoked = vi.fn();
    const url = await server(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const backend = new McpServer({ name: 'fixture', version: '1.0.0' });
      backend.registerTool('read_game', { description: '读取游戏状态', inputSchema: { title: z.string() } }, async ({ title }) => { invoked(title); return { content: [{ type: 'text', text: `${title} 未运行` }] }; });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await backend.connect(transport);
      res.on('close', () => { void backend.close(); });
      await transport.handleRequest(req, res, await body(req));
    });
    const config = { enabled: true, url: `${url}/mcp`, allowedTools: [] as string[] };
    const tools = new McpTools(() => config, () => ''); cleanups.push(() => tools.close());
    const signal = new AbortController().signal;
    expect((await tools.list(signal)).map(t => t.name)).toEqual(['read_game']);
    await expect(tools.call('read_game', { title: '星露谷' }, signal)).rejects.toThrow('未被桌面用户启用');
    config.allowedTools.push('read_game');
    expect(await tools.call('read_game', { title: '星露谷' }, signal)).toContain('星露谷 未运行');
    expect(invoked).toHaveBeenCalledExactlyOnceWith('星露谷');
    config.enabled = false; await expect(tools.call('read_game', {}, signal)).rejects.toThrow();
  });
});
