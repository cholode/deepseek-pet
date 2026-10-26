import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { SoftwareService, type SoftwareHost } from '../src/main/software/service';
import { SoftwarePlugins, inspectPlugin } from '../src/main/software/plugins';
import { softwareToolName, toolSignature } from '../src/main/software/connection';
import { softwarePluginSchema, softwareRequestSchema, type SoftwarePlugin, type SoftwareRequest } from '../src/shared/software';
import { CompanionCoordinator } from '../src/companion/coordinator';
import { fixture } from './companion-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const signal = () => new AbortController().signal;
async function directory() { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-software-')); cleanup.push(() => fs.rm(folder, { recursive: true, force: true })); return folder; }
const manifest: SoftwarePlugin = { schemaVersion: 1, id: 'test.protocol', name: '协议验证插件', version: '1.0.0', description: '仅回显协议，不操作软件', author: '', transport: { type: 'streamable-http', defaultUrl: '' } };
async function plugin(folder: string, config = manifest) { await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'software-plugin.json'), JSON.stringify(config)); return folder; }
async function service() {
  const root = await directory();
  const host: SoftwareHost = { changed: vi.fn(), cancelChat: vi.fn(), choose: vi.fn(async () => undefined), seal: async s => `sealed:${Buffer.from(s).toString('base64')}`, unseal: async s => Buffer.from(s.slice(7), 'base64').toString() };
  const manager = new SoftwareService(path.join(root, 'user'), host); await manager.start(); cleanup.push(() => manager.close());
  return { root, host, manager };
}
async function request(manager: SoftwareService, value: SoftwareRequest) { const result = await manager.request(value); if (!result.ok) throw new Error(result.message); return result; }
async function httpPlugin() {
  const calls: { args: unknown; meta: unknown; token?: string }[] = [];
  let description = '回显测试消息', failing = false;
  const http = createServer((req, res) => { void (async () => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const server = new McpServer({ name: 'protocol-fixture', version: '1.0.0' });
    server.registerTool('echo', { description, inputSchema: { text: z.string() } }, async (args, extra) => {
      calls.push({ args, meta: extra._meta, token: req.headers.authorization });
      return { isError: failing, content: [{ type: 'text', text: JSON.stringify(args) }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport); res.on('close', () => { void server.close(); }); await transport.handleRequest(req, res, body);
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  cleanup.push(async () => { http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); });
  return { url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`, calls, change: () => { description = '变更后的工具说明'; }, fail: () => { failing = true; } };
}
async function configured() {
  const backend = await httpPlugin(), f = await service();
  await f.manager.plugins.install(await plugin(path.join(f.root, 'download')));
  await request(f.manager, { type: 'save', software: { name: '协议目标', directory: f.root, pluginId: manifest.id, url: backend.url, runtimePath: '' }, token: 'fixture-token' });
  const id = f.manager.view().entries[0].id;
  return { ...f, backend, id, name: softwareToolName(id, 'echo') };
}
async function authorize(f: Awaited<ReturnType<typeof configured>>) {
  await request(f.manager, { type: 'connect', id: f.id }); await request(f.manager, { type: 'grant', id: f.id, tools: ['echo'] });
}

describe('软件插件包与隔离存储', () => {
  it('清单严格校验，入口拒绝绝对路径、逃逸与未知字段', () => {
    for (const entry of ['../x.js', '/x.js', 'C:/x.js', 'a\\x.js', 'a/../x.js']) expect(softwarePluginSchema.safeParse({ ...manifest, transport: { type: 'stdio', runtime: 'node', entry, args: [] } }).success).toBe(false);
    expect(softwarePluginSchema.safeParse({ ...manifest, run: '任意命令' }).success).toBe(false);
    expect(softwareRequestSchema.safeParse({ type: 'invoke', command: 'x' }).success).toBe(false);
  });
  it('只复制导入且不执行，重复 ID 明确拒绝，字节变化被识别', async () => {
    const root = await directory(), source = await plugin(path.join(root, 'source'));
    const store = new SoftwarePlugins(path.join(root, 'installed')); await store.load();
    const installed = await store.install(source); expect(installed.directory).not.toBe(source);
    await expect(store.install(source)).rejects.toThrow('已经安装');
    await fs.writeFile(path.join(installed.directory, 'extra.txt'), 'changed');
    await expect(store.verify(manifest.id)).rejects.toThrow('已变化');
    await store.remove(manifest.id); expect(await fs.readFile(path.join(source, 'software-plugin.json'), 'utf8')).toContain(manifest.id);
  });
  it('拒绝目录联接，不读取链接目标', async () => {
    const root = await directory(), source = await plugin(path.join(root, 'source')), outside = path.join(root, 'outside');
    await fs.mkdir(outside); await fs.symlink(outside, path.join(source, 'link'), 'junction');
    await expect(inspectPlugin(source)).rejects.toThrow('链接');
  });
  it('损坏配置备份且不影响原软件目录', async () => {
    const f = await service(), file = path.join(f.root, 'user', 'software.json'); await fs.writeFile(file, '{broken');
    const second = new SoftwareService(path.dirname(file), f.host); await second.start(); cleanup.push(() => second.close());
    expect(second.view().notice).toContain('备份'); expect(second.view().entries).toEqual([]);
    expect((await fs.readdir(path.dirname(file))).some(name => name.startsWith('software.json.corrupt-'))).toBe(true);
  });
});
describe('软件绑定、MCP 调用与权限生命周期', () => {
  it('首次保存不启动、不授权；连接、授权、调用携带可信目标；凭证不出现在状态', async () => {
    const f = await configured();
    expect(f.manager.view().entries[0]).toMatchObject({ enabled: false, grants: [], tools: [], hasToken: true });
    expect(JSON.stringify(f.manager.view())).not.toContain('fixture-token'); expect(JSON.stringify(f.manager.view())).not.toContain('sealedToken');
    expect(await f.manager.list(signal())).toEqual([]);
    await request(f.manager, { type: 'connect', id: f.id });
    expect(f.manager.view().entries[0].tools[0].name).toBe('echo');
    await expect(f.manager.call(f.name, {}, signal())).rejects.toThrow('尚未授权');
    expect((await f.manager.request({ type: 'grant', id: f.id, tools: ['fake'] })).ok).toBe(false);
    await request(f.manager, { type: 'grant', id: f.id, tools: ['echo'] });
    expect((await f.manager.list(signal()))[0].name).toBe(f.name);
    expect(await f.manager.call(f.name, { text: 'hello' }, signal())).toContain('hello');
    expect(f.backend.calls[0]).toMatchObject({ args: { text: 'hello' }, token: 'Bearer fixture-token', meta: { 'dafeiyu/target': { softwareDirectory: f.root, softwareId: f.id, pluginId: manifest.id } } });
    expect(f.manager.view().activities[0].status).toBe('completed');
  });
  it('多个软件共享插件但工具命名与授权相互隔离', async () => {
    const f = await configured(); await authorize(f);
    await request(f.manager, { type: 'save', software: { name: '第二个软件', directory: f.root, pluginId: manifest.id, url: f.backend.url, runtimePath: '' } });
    const second = f.manager.view().entries.find(e => e.id !== f.id)!;
    await request(f.manager, { type: 'connect', id: second.id });
    expect(await f.manager.list(signal())).toHaveLength(1);
    await expect(f.manager.call(softwareToolName(second.id, 'echo'), { text: 'x' }, signal())).rejects.toThrow('尚未授权');
    await request(f.manager, { type: 'grant', id: second.id, tools: ['echo'] });
    const tools = await f.manager.list(signal()); expect(new Set(tools.map(t => t.name)).size).toBe(2); expect(tools.every(t => t.name.length <= 64)).toBe(true);
  });
  it('撤权和停用立即生效，已移除的关联不能复用', async () => {
    const f = await configured(); await authorize(f);
    await request(f.manager, { type: 'grant', id: f.id, tools: [] });
    await expect(f.manager.call(f.name, {}, signal())).rejects.toThrow('尚未授权');
    await request(f.manager, { type: 'grant', id: f.id, tools: ['echo'] }); await request(f.manager, { type: 'disable', id: f.id });
    expect(await f.manager.list(signal())).toEqual([]); await expect(f.manager.call(f.name, {}, signal())).rejects.toThrow('尚未授权');
    await request(f.manager, { type: 'remove', id: f.id }); expect(f.manager.view().entries).toEqual([]);
    expect((await fs.stat(f.root)).isDirectory()).toBe(true);
  });
  it('更换目录或插件地址清除工具授权及凭证，不能借旧绑定调用', async () => {
    const f = await configured(); await authorize(f); const directory = path.join(f.root, 'second'); await fs.mkdir(directory);
    await request(f.manager, { type: 'save', software: { id: f.id, name: '换目录', directory, pluginId: manifest.id, url: f.backend.url, runtimePath: '' } });
    expect(f.manager.view().entries[0]).toMatchObject({ grants: [], tools: [], enabled: false, hasToken: false });
    await expect(f.manager.call(f.name, {}, signal())).rejects.toThrow('尚未授权');
  });
  it('重启恢复绑定和授权，但不自动启动；聊天时重新握手核对能力签名', async () => {
    const f = await configured(); await authorize(f); await f.manager.close();
    const next = new SoftwareService(path.join(f.root, 'user'), f.host); await next.start(); cleanup.push(() => next.close());
    expect(next.view().entries[0]).toMatchObject({ status: 'disconnected', enabled: true, grants: [{ name: 'echo' }] });
    expect(await next.list(signal())).toHaveLength(1);
    f.backend.change(); await request(next, { type: 'connect', id: f.id });
    expect(next.view().entries[0].grants).toEqual([]); expect(await next.list(signal())).toEqual([]);
  });
  it('插件移除、文件被修改及失败结果不能显示为成功', async () => {
    const f = await configured(); await authorize(f); f.backend.fail();
    await expect(f.manager.call(f.name, { text: 'fail' }, signal())).rejects.toThrow('操作失败');
    expect(f.manager.view().activities.at(-1)?.status).toBe('failed');
    const install = f.manager.plugins.records.get(manifest.id)!; await fs.writeFile(path.join(install.directory, 'tamper.txt'), 'changed');
    await expect(f.manager.call(f.name, { text: 'tamper' }, signal())).rejects.toThrow('文件已变化');
    await request(f.manager, { type: 'remove-plugin', id: manifest.id });
    expect(f.manager.view().plugins).toEqual([]); expect(f.manager.view().entries[0]).toMatchObject({ enabled: false, tools: [], grants: [] });
  });
  it('不合法地址和不存在的软件目录不落盘；取消选择不修改状态', async () => {
    const f = await configured();
    const previous = f.manager.view().entries;
    for (const url of ['http://example.com/mcp', 'https://name:secret@example.com/mcp']) expect((await f.manager.request({ type: 'save', software: { name: 'invalid', directory: f.root, pluginId: manifest.id, runtimePath: '', url } })).ok).toBe(false);
    expect((await f.manager.request({ type: 'save', software: { name: 'missing', directory: path.join(f.root, 'missing'), pluginId: manifest.id, runtimePath: '', url: f.backend.url } })).ok).toBe(false);
    await request(f.manager, { type: 'choose-directory', current: f.root }); expect(f.manager.view().entries).toEqual(previous);
  });
  it('连接尚未握手完成时全局停止，不会迟到恢复连接或授权', async () => {
    const f = await configured(); let arrived = false;
    const stalled = createServer((_req, _res) => { arrived = true; });
    await new Promise<void>(r => stalled.listen(0, '127.0.0.1', r));
    cleanup.push(async () => { stalled.closeAllConnections(); await new Promise<void>(r => stalled.close(() => r())); });
    await request(f.manager, { type: 'save', software: { id: f.id, name: '等待中的连接', directory: f.root, pluginId: manifest.id, runtimePath: '', url: `http://127.0.0.1:${(stalled.address() as { port: number }).port}/mcp` } });
    const connecting = f.manager.request({ type: 'connect', id: f.id }); await vi.waitFor(() => expect(arrived).toBe(true));
    await request(f.manager, { type: 'stop' }); expect((await connecting).ok).toBe(false);
    expect(f.manager.view().entries[0]).toMatchObject({ enabled: false, grants: [], tools: [] });
    expect(await f.manager.list(signal())).toEqual([]);
  });
  it('签名不受 JSON 属性顺序影响，工具说明变化撤销旧许可', () => {
    expect(toolSignature({ name: 'x', inputSchema: { type: 'object', properties: {} } })).toBe(toolSignature({ inputSchema: { properties: {}, type: 'object' }, name: 'x' }));
    expect(toolSignature({ name: 'x', inputSchema: {}, description: 'a' })).not.toBe(toolSignature({ name: 'x', inputSchema: {}, description: 'b' }));
  });
});

describe('真实本地插件进程及模型路由', () => {
  it('stdio 使用独立进程、注入软件目录；取消和全部停止会关闭进程并阻止后续调用', async () => {
    const f = await service(), download = path.join(f.root, 'download');
    await plugin(download, { ...manifest, transport: { type: 'stdio', runtime: 'node', entry: 'server.mjs', args: ['${softwareDirectory}'] } });
    const sdk = (file: string) => pathToFileURL(path.resolve(`node_modules/@modelcontextprotocol/sdk/dist/esm/${file}.js`)).href;
    const zod = pathToFileURL(path.resolve('node_modules/zod/index.js')).href;
    await fs.writeFile(path.join(download, 'server.mjs'), `import { McpServer } from ${JSON.stringify(sdk('server/mcp'))};\nimport { StdioServerTransport } from ${JSON.stringify(sdk('server/stdio'))};\nimport { z } from ${JSON.stringify(zod)};\nconst s = new McpServer({name:'fixture',version:'1'});\ns.registerTool('echo',{inputSchema:{text:z.string()}},async ({text}, extra)=> { if(text==='change') { s.registerTool('new_tool',{},async()=>({content:[]})); await new Promise(r=>setTimeout(r,200)); } if(text==='wait') await new Promise(resolve=>extra.signal.addEventListener('abort',resolve,{once:true})); return {content:[{type:'text',text:JSON.stringify({text,directory:process.env.DAFEIYU_SOFTWARE_DIRECTORY,arg:process.argv[2],pid:process.pid,cwd:process.cwd(),data:process.env.DAFEIYU_PLUGIN_DATA_DIRECTORY})}]}; });\nawait s.connect(new StdioServerTransport());`);
    await f.manager.plugins.install(download);
    await request(f.manager, { type: 'save', software: { name: '测试进程', directory: f.root, pluginId: manifest.id, url: '', runtimePath: process.execPath } });
    const id = f.manager.view().entries[0].id, name = softwareToolName(id, 'echo');
    await request(f.manager, { type: 'connect', id }); await request(f.manager, { type: 'grant', id, tools: ['echo'] });
    const response = JSON.parse(await f.manager.call(name, { text: 'hello' }, signal()));
    const output = JSON.parse(response.content[0].text); expect(output).toMatchObject({ directory: f.root, arg: f.root }); expect(output.pid).not.toBe(process.pid); expect(output.cwd).toBe(output.data); expect(output.data).not.toBe(f.root);
    await expect(f.manager.call(name, { text: 'change' }, signal())).rejects.toThrow();
    expect(f.manager.view().entries[0]).toMatchObject({ enabled: false, grants: [] });
    await request(f.manager, { type: 'connect', id }); await request(f.manager, { type: 'grant', id, tools: ['echo'] });
    const next = JSON.parse(JSON.parse(await f.manager.call(name, { text: 'hello-again' }, signal())).content[0].text);
    const controller = new AbortController(); const call = f.manager.call(name, { text: 'wait' }, controller.signal); const rejected = expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(f.manager.view().activities.at(-1)?.status).toBe('running')); controller.abort(); await rejected;
    await vi.waitFor(() => expect(() => process.kill(output.pid, 0)).toThrow());
    await vi.waitFor(() => expect(() => process.kill(next.pid, 0)).toThrow());
    expect(f.manager.view().activities.at(-1)?.status).toBe('cancelled');
    await request(f.manager, { type: 'stop' }); expect(f.manager.view().entries[0].enabled).toBe(false); expect(await f.manager.list(signal())).toEqual([]);
  }, 15000);
  it('软件工具独立于旧 MCP 开关；模型收到实际结果，QQ 和主动对话不能调用', async () => {
    const f = await configured(); await authorize(f); const domain = fixture();
    domain.data.config.memory.automatic = false; domain.data.config.mood.enabled = false;
    const coordinator = new CompanionCoordinator(domain.repository, domain.model, domain.tools, domain.host, f.manager);
    domain.model.complete.mockResolvedValueOnce({ text: '', calls: [{ id: 'c', type: 'function', function: { name: f.name, arguments: '{"text":"from-model"}' } }] }).mockResolvedValueOnce({ text: '协议验证完成', calls: [] });
    expect(await coordinator.chat('验证插件')).toBe('协议验证完成'); expect(f.backend.calls[0].args).toEqual({ text: 'from-model' });
    expect(domain.model.complete.mock.calls[1][0]).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'c', content: expect.stringContaining('from-model') }));
    for (const source of ['qq-private', 'qq-group', 'initiative'] as const) {
      domain.model.complete.mockResolvedValueOnce({ text: '普通回复', calls: [] }); await coordinator.chat('你好', source);
      expect(domain.model.complete.mock.calls.at(-1)?.[3]).toEqual([]);
    }
    expect(f.backend.calls).toHaveLength(1);
  });
});
