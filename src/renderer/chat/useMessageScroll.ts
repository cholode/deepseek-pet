import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// 只在用户仍位于底部时跟随新内容；阅读旧段落时保留当前位置。
export function useMessageScroll(version: unknown, resetKey: unknown, startAtTop = false) {
  const ref = useRef<HTMLDivElement>(null), follow = useRef(true), previous = useRef<unknown>(undefined);
  const [overflow, setOverflow] = useState(false), [atBottom, setAtBottom] = useState(true);
  const measure = useCallback(() => {
    const element = ref.current; if (!element) return;
    if (follow.current) element.scrollTop = element.scrollHeight;
    setOverflow(element.scrollHeight > element.clientHeight + 2);
    setAtBottom(element.scrollHeight - element.clientHeight - element.scrollTop < 24);
  }, []);
  useLayoutEffect(() => {
    if (previous.current !== resetKey) {
      previous.current = resetKey; follow.current = !startAtTop;
      if (startAtTop && ref.current) ref.current.scrollTop = 0;
    }
    measure();
  }, [version, resetKey, startAtTop, measure]);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [resetKey, measure]);
  const onScroll = useCallback(() => {
    const element = ref.current; if (!element) return;
    follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
    setAtBottom(follow.current);
  }, []);
  const toLatest = useCallback(() => { follow.current = true; measure(); }, [measure]);
  const toStart = useCallback(() => { follow.current = false; if (ref.current) ref.current.scrollTop = 0; measure(); }, [measure]);
  return { ref, overflow, atBottom, onScroll, toLatest, toStart };
}
