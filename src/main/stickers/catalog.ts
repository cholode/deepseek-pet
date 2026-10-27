import { createHash } from 'node:crypto';
import type { Sticker } from '../../shared/stickers';

export function stickerKey(item: Sticker) { return createHash('sha256').update(`${item.url}\n${item.hash}`).digest('hex'); }
export function imageUrl(item: Sticker) { return `petsticker://local/${stickerKey(item)}.gif`; }

// 基于上游 dsh-nekowhale-stickers 的字段权重与中文双字匹配思路，适配本地目录。
// 来源与许可随独立插件的 NOTICE / LICENSE 保留。
export function searchStickers(items: readonly Sticker[], query: string) {
  const terms = query.toLowerCase().split(/[\s,，。.!！?？、;；:：/|]+/u).filter(Boolean);
  if (!terms.length) return [...items];
  return items.map(item => {
    const fields: [string, number][] = [[item.name, 6], [item.tags.join(' '), 5], [item.emotion, 4], [item.text, 4], [item.use, 3], [item.meme, 3], [item.direction, 2], [item.description, 1]];
    let matches = 0, score = 0;
    for (const term of terms) {
      let best = 0;
      for (const [raw, weight] of fields) {
        const text = raw.toLowerCase();
        if (text.includes(term)) best = Math.max(best, weight * (text === term ? 1.5 : 1));
        else if (/[㐀-鿿豈-﫿]/u.test(term) && term.length > 2) {
          const pairs = Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2));
          best = Math.max(best, weight * pairs.filter(pair => text.includes(pair)).length / pairs.length * 0.8);
        }
      }
      if (best) matches++; score += best;
    }
    return { item, score: score * (matches / terms.length) ** 2 };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).map(hit => hit.item);
}
