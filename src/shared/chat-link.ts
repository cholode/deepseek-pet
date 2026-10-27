// 聊天内容只能请求打开普通网页，不能把模型生成的地址交给系统执行程序。
export function chatLink(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 4096 || [...raw].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    return url.href;
  } catch { return; }
}
