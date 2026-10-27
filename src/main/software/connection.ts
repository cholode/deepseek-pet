import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { softwareToolSchema, type SoftwareEntry, type SoftwareTool } from '../../shared/software';
import type { PluginRecord } from './plugins';
import { endpoint } from '../companion/http';
import { version as appVersion } from '../../../package.json';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function toolSignature(value: { name: string; description?: string; inputSchema: unknown }) {
  return createHash('sha256').update(canonical({ name: value.name, description: value.description ?? '', inputSchema: value.inputSchema })).digest('hex');
}
export function softwareToolName(id: string, name: string) { return `sw_${id.replaceAll('-', '')}_${createHash('sha256').update(name).digest('hex').slice(0, 16)}`; }
export async function runtimeExecutable(raw: string) {
  if (!path.isAbsolute(raw) || raw.startsWith('\\\\') || raw.startsWith('//') || (process.platform === 'win32' && path.extname(raw).toLowerCase() !== '.exe')) throw new Error('请选择本机运行时的可执行文件（Windows 下为 .exe）');
  const actual = await fs.realpath(raw);
  if (!(await fs.stat(actual)).isFile()) throw new Error('运行时必须是可执行文件');
  return actual;
}
// 路径由主进程配置注入，模型不能选择命令、运行时或工作目录；插件通过标准 MCP 自述能力。
export class SoftwareConnection {
  private client = new Client({ name: 'dafeiyu-software-host', version: appVersion });
  private closing = false;
  readonly abort = new AbortController();
  constructor(private entry: SoftwareEntry, private plugin: PluginRecord, private dataDirectory: string, private invalidated: (message: string) => void) {
    this.client.onclose = () => { if (!this.closing) this.invalidated('插件连接已断开，请重新连接'); };
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.invalidated('插件能力已变化，请重新连接并授权'));
  }
  async connect(token: string, parent: AbortSignal): Promise<SoftwareTool[]> {
    const signal = AbortSignal.any([parent, this.abort.signal, AbortSignal.timeout(20000)]);
    signal.throwIfAborted();
    const config = this.plugin.manifest.transport;
    let transport: Transport;
    if (config.type === 'stdio') {
      const entry = path.resolve(this.plugin.directory, config.entry);
      const useHostNode = config.runtime === 'node' && !this.entry.runtimePath;
      const command = config.runtime === 'executable' ? entry : useHostNode ? process.execPath : await runtimeExecutable(this.entry.runtimePath);
      const variables: Record<string, string> = { '${softwareDirectory}': this.entry.directory, '${pluginDirectory}': this.plugin.directory };
      const args = config.args.map(arg => arg.replace(/\$\{[^}]+\}/g, key => { if (!(key in variables)) throw new Error(`插件包含未知参数占位符：${key}`); return variables[key]; }));
      const stdio = new StdioClientTransport({
        command, args: [...(config.runtime === 'executable' ? [] : [entry]), ...args], cwd: this.dataDirectory, stderr: 'pipe', maxBufferSize: 2 * 1024 * 1024,
        env: { DAFEIYU_SOFTWARE_DIRECTORY: this.entry.directory, DAFEIYU_SOFTWARE_ID: this.entry.id, DAFEIYU_PLUGIN_DIRECTORY: this.plugin.directory, DAFEIYU_PLUGIN_DATA_DIRECTORY: this.dataDirectory, PYTHONDONTWRITEBYTECODE: '1', ...(useHostNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
      });
      // 排空诊断流，避免子进程阻塞；不把可能含凭证的插件日志写入公共日志。
      stdio.stderr?.on('data', () => {}); transport = stdio;
    } else {
      transport = new StreamableHTTPClientTransport(endpoint(this.entry.url), {
        requestInit: { redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : {} },
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' })
      });
    }
    try {
      signal.throwIfAborted(); await this.client.connect(transport, { signal, timeout: 15000 });
      const tools: SoftwareTool[] = []; let cursor: string | undefined;
      const names = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const result = await this.client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 });
        for (const tool of result.tools) {
          if (names.has(tool.name)) throw new Error('插件返回了重复的工具名称');
          if (JSON.stringify(tool).length > 64000) throw new Error('插件的工具定义过大');
          names.add(tool.name);
          tools.push(softwareToolSchema.parse({ name: tool.name, description: (tool.description ?? '').slice(0, 1200), inputSchema: tool.inputSchema, signature: toolSignature(tool) }));
          if (tools.length > 100) throw new Error('单个软件最多提供 100 项能力');
        }
        cursor = result.nextCursor; if (!cursor) return tools;
      }
      throw new Error('插件工具分页过多');
    } catch (e) { await this.close(); throw e; }
  }
  async call(name: string, args: Record<string, unknown>, parent: AbortSignal) {
    const signal = AbortSignal.any([parent, this.abort.signal]); signal.throwIfAborted();
    const result = await this.client.callTool({ name, arguments: args, _meta: { 'dafeiyu/target': { softwareId: this.entry.id, softwareDirectory: this.entry.directory, pluginId: this.entry.pluginId } } }, undefined, { signal, timeout: 30000 });
    signal.throwIfAborted();
    if (result.isError) {
      const detail = Array.isArray(result.content) ? result.content.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 600) : '';
      throw new Error(`插件报告操作失败：${detail || '请检查插件与目标软件状态'}`);
    }
    const text = JSON.stringify(result); return text.length > 12000 ? `${text.slice(0, 12000)}（插件结果已截断）` : text;
  }
  async close() { this.closing = true; this.abort.abort(); await this.client.close().catch(() => {}); }
}
