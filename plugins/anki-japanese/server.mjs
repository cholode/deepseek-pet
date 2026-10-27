import readline from 'node:readline';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { AnkiPlugin, tools } from './core.mjs';

// 只实现本插件的有限工具；stdout 专用于 MCP，网络固定为本机 AnkiConnect。
// 插件握手与独立发布包共用自身清单的版本，不跟随主程序版本。
const manifest = JSON.parse(await readFile(new URL('./software-plugin.json', import.meta.url), 'utf8'));
const directory = process.env.DAFEIYU_PLUGIN_DATA_DIRECTORY;
if (!directory) throw new Error('需要大肥鱼提供独立插件数据目录');
const plugin = new AnkiPlugin(directory);
let startupError;
try { await plugin.load(); } catch (e) { startupError = e.message; }
const controllers = new Map(); let queue = Promise.resolve();
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  if (line.length > 64000) return;
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.method === 'notifications/cancelled') { controllers.get(req.params?.requestId)?.abort(); return; }
  if (req.id === undefined) return;
  if (req.method === 'initialize') { reply(req.id, { protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(req.params?.protocolVersion) ? req.params.protocolVersion : '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: manifest.id, version: manifest.version } }); return; }
  if (req.method === 'ping') { reply(req.id, {}); return; }
  if (req.method === 'tools/list') { reply(req.id, { tools }); return; }
  if (req.method !== 'tools/call') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: '未知方法' } }) + '\n'); return; }
  const controller = new AbortController(); controllers.set(req.id, controller);
  queue = queue.then(async () => {
    try {
      controller.signal.throwIfAborted(); if (startupError) throw new Error(startupError);
      const result = await plugin.call(req.params?.name, req.params?.arguments ?? {}, controller.signal);
      reply(req.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (e) { reply(req.id, { isError: true, content: [{ type: 'text', text: e.message || '调用失败' }] }); }
    finally { controllers.delete(req.id); }
  });
});
input.on('close', () => { for (const c of controllers.values()) c.abort(); });
