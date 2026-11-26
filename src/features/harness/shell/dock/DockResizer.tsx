/**
 * DockResizer —— 右 dock 左缘的拖拽分隔条。
 *
 * 职责：按住 dock 左缘拖动改宽度（跨平台统一用 pointer 事件，不用
 * HTML5 drag —— 后者在 WebView 里行为不一致）。宽度真源是 shellUi
 * store 的 `dockWidth`（null = 用户没拖过，用各档位默认宽度）。
 *
 * 落盘策略：拖拽中只改内存态（每帧写 localStorage 会造成 IO 抖动），
 * 松手时 commitDockWidth 落盘一次；键盘调整每次即落盘。
 *
 * 渲染层不参与：分隔条经 ShellSlots 注入（渲染层禁 hook，见
 * scripts/check-render-boundaries.mjs）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';

/** dock 宽度下限（窄于此内容不可读）。 */
export const DOCK_WIDTH_MIN = 280;
/** dock 宽度绝对上限。 */
export const DOCK_WIDTH_MAX = 720;
/** 键盘调整步长（px）。 */
const KEY_STEP = 16;

/** 宽度上限：绝对上限与窗口比例上限取小。 */
export function maxDockWidth(): number {
  const viewport = typeof window === 'undefined' ? DOCK_WIDTH_MAX : window.innerWidth;
  return Math.min(DOCK_WIDTH_MAX, Math.round(viewport * 0.6));
}

/** 把宽度钳制到 [min, max]。 */
export function clampDockWidth(width: number): number {
  return Math.max(DOCK_WIDTH_MIN, Math.min(maxDockWidth(), Math.round(width)));
}

export function DockResizer() {
  const { t } = useI18n();
  const dockWidth = useShellUi((s) => s.dockWidth);
  const setDockWidth = useShellUi((s) => s.setDockWidth);
  const commitDockWidth = useShellUi((s) => s.commitDockWidth);
  const [width, setWidth] = useState<number>(dockWidth ?? DOCK_WIDTH_MIN);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  /** 当前 dock 的实际渲染宽度。 */
  const measure = useCallback((): number => {
    // 用户拖过的宽度以 store 为准(样式由 CSS 变量驱动,DOM 量的是上一帧);
    // 未拖过时各档位默认宽度由 CSS 决定 → 量 DOM。
    if (dockWidth !== null) return dockWidth;
    const host = hostRef.current?.parentElement;
    if (host) {
      const w = host.getBoundingClientRect().width;
      if (w > 0) return w;
    }
    return DOCK_WIDTH_MIN;
  }, [dockWidth]);

  // 卸载时清掉拖拽标记，避免 <html> 上残留 data-dock-dragging。
  useEffect(() => () => {
    document.documentElement.removeAttribute('data-dock-dragging');
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startWidth = measure();
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth };
    // 指针捕获在部分环境(如 jsdom)不可用 —— 缺失时降级为「不捕获」,
    // 监听仍挂在元素自身上,行为不受影响。
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.documentElement.setAttribute('data-dock-dragging', '');
    setWidth(startWidth);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // 分隔条左移 → dock 变宽（与分隔条常规语义一致）。
    pendingRef.current = clampDockWidth(drag.startWidth + (drag.startX - e.clientX));
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const next = pendingRef.current;
      if (next === null) return;
      setWidth(next);
      setDockWidth(next);
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const last = pendingRef.current;
    if (last !== null) {
      setWidth(last);
      setDockWidth(last);
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.documentElement.removeAttribute('data-dock-dragging');
    commitDockWidth();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = measure();
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = current + KEY_STEP;
    else if (e.key === 'ArrowRight') next = current - KEY_STEP;
    else if (e.key === 'Home') next = DOCK_WIDTH_MIN;
    else if (e.key === 'End') next = maxDockWidth();
    if (next === null) return;
    e.preventDefault();
    const w = clampDockWidth(next);
    setWidth(w);
    setDockWidth(w);
    commitDockWidth();
  };

  return (
    <div
      ref={hostRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('harness.dock.resize')}
      aria-valuenow={Math.round(width)}
      aria-valuemin={DOCK_WIDTH_MIN}
      aria-valuemax={maxDockWidth()}
      tabIndex={0}
      className="dock-resizer"
      data-testid="harness-dock-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onFocus={() => setWidth(measure())}
    />
  );
}
