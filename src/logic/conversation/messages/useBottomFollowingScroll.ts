/**
 * useBottomFollowingScroll —— 滚动容器吸底跟随 + 边缘渐隐遮罩。
 *
 * 对齐 ZCode packages/ui 的 scrollMask.ts 方案（思考块 / 活动组体共用）：
 *  - 「跟随」语义：视口距底 ≤ 2px 视为吸底 → 内容增高时自动滚到最新；
 *    用户向上滚动即暂停跟随，滚回底部自动恢复；
 *  - `follow` 为 false 时不主动吸底 —— 已完成的内容展开时停在顶部，
 *    阅读位置完全交给用户；follow 翻回 true（如流式期间展开）则恢复跟随；
 *  - 内容/容器尺寸变化经 ResizeObserver 感知；jsdom 无 ResizeObserver 时
 *    退化为依赖 `contentVersion` 变化触发同步（测试环境可断言状态流转）；
 *  - 顺带产出上/下边缘 24px 渐隐遮罩（mask-image 内联样式），哪一侧有
 *    被裁掉的内容就在哪一侧渐淡（ZCode 同款 24px 渐隐带）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

export type ScrollMaskData = 'top' | 'bottom' | 'both' | 'none';

/** 边缘渐隐带高度（px，ZCode 同款）。 */
const MASK_FADE_PX = 24;
/** 距底 ≤ 2px 视为吸底（ZCode 同款阈值）。 */
const NEAR_BOTTOM_PX = 2;

export interface BottomFollowingScroll {
  /** 滚动容器 ref（挂 max-height + overflow 的那层）。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 内容 ref（随文本增高撑开容器的那层）。 */
  contentRef: RefObject<HTMLDivElement | null>;
  /** 透传给滚动容器的 onScroll —— 维护跟随态 + 刷新遮罩。 */
  onScroll: () => void;
  /** 当前遮罩档位（供测试/调试断言）。 */
  maskData: ScrollMaskData;
  /** 内联 mask-image 样式；'none' 时为空对象。 */
  maskStyle: CSSProperties;
}

const MASK_IMAGE: Record<Exclude<ScrollMaskData, 'none'>, string> = {
  top: `linear-gradient(to bottom, transparent 0px, black ${MASK_FADE_PX}px)`,
  bottom: `linear-gradient(to bottom, black calc(100% - ${MASK_FADE_PX}px), transparent 100%)`,
  both: `linear-gradient(to bottom, transparent 0px, black ${MASK_FADE_PX}px, black calc(100% - ${MASK_FADE_PX}px), transparent 100%)`,
};

export function useBottomFollowingScroll(
  active: boolean,
  contentVersion: string | number,
  follow = false,
): BottomFollowingScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(follow);
  const [maskData, setMaskData] = useState<ScrollMaskData>('none');

  const updateMask = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const topHidden = el.scrollTop > 1;
    const bottomHidden = el.scrollHeight - el.scrollTop - el.clientHeight > 1;
    const next = topHidden && bottomHidden ? 'both' : topHidden ? 'top' : bottomHidden ? 'bottom' : 'none';
    setMaskData((prev) => (prev === next ? prev : next));
  }, []);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (el && followingRef.current) el.scrollTop = el.scrollHeight;
    updateMask();
  }, [updateMask]);

  // 滚动即重估跟随态：用户上滚离开底部 → 暂停；回到底部 → 恢复。
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    updateMask();
  }, [updateMask]);

  // follow 翻回 true（如流式期间展开）时恢复跟随并立即吸底。
  useEffect(() => {
    if (!follow) return;
    followingRef.current = true;
    sync();
  }, [follow, sync]);

  // 展开挂载 / 内容增高（version 变化）/ 尺寸变化（ResizeObserver）时同步。
  useEffect(() => {
    if (!active) return;
    sync();
    const el = scrollRef.current;
    const content = contentRef.current;
    if (typeof ResizeObserver === 'undefined' || !el || !content) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, [active, contentVersion, sync]);

  const maskStyle = useMemo<CSSProperties>(
    () => (maskData === 'none' ? {} : { maskImage: MASK_IMAGE[maskData], WebkitMaskImage: MASK_IMAGE[maskData] }),
    [maskData],
  );

  return { scrollRef, contentRef, onScroll, maskData, maskStyle };
}
