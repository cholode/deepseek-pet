import { useRef, useState } from 'react';
import type { StickerItem } from '../../shared/stickers';
import { insertEmoji } from '../../shared/chat-draft';

export function useChatDraft() {
  const [text, setText] = useState(''), [sticker, setSticker] = useState<StickerItem>();
  const [picker, setPicker] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  function emoji(value: string) {
    const start = input.current?.selectionStart ?? text.length, end = input.current?.selectionEnd ?? start;
    const result = insertEmoji(text, value, start, end); if (!result) return false;
    setText(result.text); setPicker(false);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(result.cursor, result.cursor); });
    return true;
  }
  return { text, setText, sticker, setSticker, picker, setPicker, input, emoji };
}
