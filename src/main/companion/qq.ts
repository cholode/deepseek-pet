import { z } from 'zod';
import type { CompanionConfig } from '../../shared/companion';
import { endpoint, readJson } from './http';
const envelope = z.object({ status: z.string().optional(), retcode: z.number(), data: z.unknown() });
const messageSchema = z.object({ message_id: z.union([z.number(), z.string()]), time: z.number(), user_id: z.union([z.number(), z.string()]), message: z.union([z.string(), z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }))]) });
export interface QqInput { id: string; at: number; text: string; conversationId: string; source: 'qq-private' | 'qq-group' }
// 第一版只接收绑定用户的文字；群里必须 @ 机器人或以“大肥鱼”开头，避免旁听全部群消息。
export class OneBotChannel {
  constructor(private config: () => CompanionConfig['qq'], private token: () => string, private request: typeof fetch = fetch) {}
  private async rpc(method: string, params: Record<string, unknown>, signal: AbortSignal) {
    const root = endpoint(this.config().baseUrl, true).toString().replace(/\/$/, '');
    const response = await this.request(`${root}/${method}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}) }, body: JSON.stringify(params) });
    const result = envelope.parse(await readJson(response));
    if (result.retcode !== 0 || result.status === 'failed') throw new Error(`OneBot ${method} 未成功`);
    return result.data;
  }
  async poll(since: number, signal: AbortSignal): Promise<QqInput[]> {
    const config = this.config(); if (!config.enabled || !config.ownerId || !config.targetId) return [];
    const login = z.object({ user_id: z.union([z.number(), z.string()]) }).parse(await this.rpc('get_login_info', {}, signal));
    const data = await this.rpc(config.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history', config.kind === 'group' ? { group_id: config.targetId, count: 30 } : { user_id: config.targetId, count: 30 }, signal);
    const messages = z.object({ messages: z.array(messageSchema) }).parse(data).messages;
    return messages.filter(m => String(m.user_id) === config.ownerId && m.time * 1000 >= since && String(m.user_id) !== String(login.user_id)).map(m => {
      const text = typeof m.message === 'string' ? m.message.replace(/\[CQ:[^\]]+\]/g, '') : m.message.filter(s => s.type === 'text').map(s => String(s.data.text ?? '')).join('');
      const mentioned = typeof m.message === 'string' ? m.message.includes(`[CQ:at,qq=${login.user_id}]`) : m.message.some(s => s.type === 'at' && String(s.data.qq) === String(login.user_id));
      return { id: `qq:${config.kind}:${config.targetId}:${m.message_id}`, at: m.time * 1000, text: text.trim().slice(0, 4000), conversationId: `qq:${config.kind}:${config.targetId}`, source: config.kind === 'group' ? 'qq-group' as const : 'qq-private' as const, allowed: config.kind === 'private' || mentioned || /^大肥鱼/.test(text.trim()) };
    }).filter(m => m.allowed && m.text).sort((a, b) => a.at - b.at);
  }
  async send(text: string, signal: AbortSignal) {
    const config = this.config(); if (!config.enabled) return;
    // 文本使用消息段，模型输出中的 CQ 字符不会变成文件、图片或额外操作。
    await this.rpc(config.kind === 'group' ? 'send_group_msg' : 'send_private_msg', { [config.kind === 'group' ? 'group_id' : 'user_id']: config.targetId, message: [{ type: 'text', data: { text: text.slice(0, 4000) } }] }, signal);
  }
}
