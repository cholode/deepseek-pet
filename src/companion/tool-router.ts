import type { ToolPort } from './ports';

// 只路由当前轮发现的能力；表情不进入“正在操作软件”的动作情境。
export class ToolRouter implements ToolPort {
  private routes = new Map<string, ToolPort>();
  constructor(private ports: ToolPort[]) {}
  async list(signal: AbortSignal) {
    this.routes.clear();
    const definitions = [];
    for (const port of this.ports) for (const tool of await port.list(signal)) {
      if (this.routes.has(tool.name)) throw new Error('插件工具名称冲突');
      this.routes.set(tool.name, port); definitions.push(tool);
    }
    return definitions;
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const port = this.routes.get(name); if (!port) throw new Error('工具未启用或未授权');
    return port.call(name, args, signal);
  }
  decorateReply(text: string) { return this.ports.reduce((value, port) => port.decorateReply?.(value) ?? value, text); }
  async close() { await Promise.all(this.ports.map(port => port.close())); this.routes.clear(); }
}
