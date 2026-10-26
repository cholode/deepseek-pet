// 零依赖 MCP 协议骨架：只完成初始化和空能力目录，不操作任何软件。
// 实际插件可改用官方 SDK 实现工具、参数校验、取消和业务逻辑。
import readline from 'node:readline';
import process from 'node:process';
const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = {
    protocolVersion: supported.includes(request.params?.protocolVersion) ? request.params.protocolVersion : supported[0],
    capabilities: { tools: {} }, serverInfo: { name: 'software-plugin-template', version: '0.1.0' }
  };
  else if (request.method === 'tools/list') result = { tools: [] };
  else if (request.method === 'ping') result = {};
  process.stdout.write(JSON.stringify(result !== undefined ? { jsonrpc: '2.0', id: request.id, result } : { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: '此模板尚未实现操作能力' } }) + '\n');
});
