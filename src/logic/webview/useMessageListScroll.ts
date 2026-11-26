import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Turn } from '@/stores/agent/types';

/** 判定「已贴近底部」的像素阈值。 */
const NEAR_BOTTOM_PX = 64;

/**
 * 消息流滚动跟随。
 *
 * 三条规则:
 * 1. **换会话强制回底** —— 消息容器 DOM 在会话间复用,旧的 `scrollTop`
 *    会保留;新会话更长时「距底部」很大,只按阈值判定就会停在半路(通常
 *    是顶部)。所以 sessionKey 变化即无条件落到底部。
 * 2. **贴底跟随** —— 用户没有主动上滚时,turns 变化(流式增量 / 新回合)
 *    就把视图钉在底部。
 * 3. **用户上滚即让位** —— 主动上滚超过阈值后停止跟随,回滚到附近再恢复;
 *    避免用户读历史时被强行拽回底部。
 *
 * 内容尺寸变化(图片加载 / markdown 异步渲染 / 折叠块展开)也会改变
 * `scrollHeight`,由 ResizeObserver 在贴底时补一次。
 *
 * @param turns 当前会话的回合列表(引用变化即触发跟随判定)。
 * @param sessionKey 会话标识;变化即强制回底(不传则只按 turns 跟随)。
 */
export function useMessageListScroll(turns: readonly Turn[], sessionKey?: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  /** 是否应贴底跟随 —— 初始 true(首次挂载直接落到底部)。 */
  const stickRef = useRef(true);
  /** 上一次的会话标识,用于检测换会话。 */
  const sessionRef = useRef(sessionKey);

  /** 把视图钉到底部。 */
  const scrollToBottom = () => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  // 换会话:无条件回底并恢复贴底意图。
  useLayoutEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey;
    stickRef.current = true;
    scrollToBottom();
  }, [sessionKey]);

  // turns 变化:贴底时跟随。
  useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [turns]);

  // 用户滚动:更新贴底意图(上滚超阈值 → 让位,回到底部附近 → 恢复)。
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      stickRef.current = distance < NEAR_BOTTOM_PX;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  // 内容尺寸变化(图片 / markdown / 折叠块):贴底时补一次。
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
    });
    // 观察内容包裹层而非滚动容器本身 —— 后者尺寸不变,内容长高它不会触发。
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return ref;
}