export function endpoint(raw: string, localOnly = false): URL {
  const url = new URL(raw); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search || !['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址必须为无账号、参数和片段的 HTTP(S) 地址');
  if ((localOnly && !local) || (!local && url.protocol !== 'https:')) throw new Error(localOnly ? 'QQ 桥只连接本机 OneBot 服务' : '远程服务必须使用 HTTPS');
  return url;
}
export async function readJson(response: Response, limit = 1000000): Promise<unknown> {
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}，请检查地址、模型和密钥`);
  if (!response.body) throw new Error('服务返回空内容');
  const reader = response.body.getReader(); let size = 0; const parts: Uint8Array[] = [];
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw new Error('服务响应超过大小限制'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
