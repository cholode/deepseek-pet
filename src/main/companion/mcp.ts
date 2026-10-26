import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolPort, ToolDefinition } from '../../companion/ports';
import type { CompanionConfig } from '../../shared/companion';
import { endpoint } from './http';

// MCP 是独立适配器，只支持用户填写的 Streamable HTTP 端点，不隐式启动外部程序。
export class McpTools implements ToolPort {
  private client?: Client; private definitions: ToolDefinition[] = [];
  constructor(private config: () => CompanionConfig['mcp'], private token: () => string) {}
  async list(signal: AbortSignal): Promise<ToolDefinition[]> {
    if (!this.config().enabled) return [];
    if (this.client) return this.definitions;
    const url = endpoint(this.config().url); const client = new Client({ name: 'dafeiyu-pet', version: '1.4.0' });
    const token = this.token();
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : {} }, fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }) });
    try {
      await client.connect(transport, { signal, timeout: 15000 });
      const collected: ToolDefinition[] = []; let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const result = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 });
        for (const tool of result.tools) if (/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) collected.push({ name: tool.name, description: (tool.description ?? '').slice(0, 1200), inputSchema: tool.inputSchema });
        cursor = result.nextCursor; if (!cursor) break;
      }
      this.client = client; this.definitions = collected.slice(0, 100); return this.definitions;
    } catch (e) { await client.close().catch(() => {}); throw e; }
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const config = this.config();
    if (!config.enabled || !config.allowedTools.includes(name) || !this.client || !this.definitions.some(t => t.name === name)) throw new Error('该 MCP 工具未被桌面用户启用');
    const result = await this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30000 });
    const text = JSON.stringify(result);
    return text.length > 12000 ? `${text.slice(0, 12000)}（工具结果已截断）` : text;
  }
  async close() { const client = this.client; this.client = undefined; this.definitions = []; if (client) await client.close().catch(() => {}); }
}
