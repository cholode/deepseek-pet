import { describe, expect, it } from 'vitest';
import { insertEmoji } from '../src/shared/chat-draft';
import { companionRequestSchema } from '../src/shared/companion';
import { quickChatRequestSchema } from '../src/shared/pet-chat';

describe('聊天表情草稿', () => {
  it('Emoji 插入光标位置或替换选区，保留前后文字及组合 Emoji', () => {
    expect(insertEmoji('早上好', '😊', 2, 2)).toEqual({ text: '早上😊好', cursor: 4 });
    expect(insertEmoji('今天难过了', '❤️', 2, 4)).toEqual({ text: '今天❤️了', cursor: 4 });
  });
  it('达到长度限制时不截断 Emoji 或已有文字', () => {
    expect(insertEmoji('鱼'.repeat(3999), '😊', 3999, 3999)).toBeUndefined();
    expect(insertEmoji('鱼'.repeat(4000), '😊', 3998, 4000)?.text.length).toBe(4000);
  });
  it('小屋与快捷聊天都允许只发表情，拒绝完全空白、额外路径及超长文字', () => {
    for (const [schema, type] of [[companionRequestSchema, 'chat'], [quickChatRequestSchema, 'send']] as const) {
      expect(schema.safeParse({ type, text: '', stickerId: 'custom:test' }).success).toBe(true);
      expect(schema.safeParse({ type, text: '  ' }).success).toBe(false);
      expect(schema.safeParse({ type, text: '😊' }).success).toBe(true);
      expect(schema.safeParse({ type, text: '鱼'.repeat(4001), stickerId: 'x' }).success).toBe(false);
      expect(schema.safeParse({ type, text: '好', path: 'C:/secret.png' }).success).toBe(false);
    }
  });
});
