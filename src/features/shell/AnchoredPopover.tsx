/**
 * 锚定浮层：把子内容挂到窗口层并按锚点定位，避开右 dock 的滚动裁切。
 *
 * 有状态原语（useLayoutEffect + createPortal），放 features 层而非 render 层
 * （render 层禁止 hook / react-dom / window / document）。定位口径复用会话
 * ⋯ 菜单：优先贴锚点右侧、下方放不下则翻到上方。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface AnchoredPopoverProps {
  anchor: HTMLElement | null;
  className: string;
  testId?: string;
  onDismiss: () => void;
  children: ReactNode;
}

export function AnchoredPopover({ anchor, className, testId, onDismiss, children }: AnchoredPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const menu = ref.current;
      if (!menu) return;
      const box = anchor.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const margin = 8;
      const left = Math.max(margin, Math.min(box.right - width, window.innerWidth - width - margin));
      const below = box.bottom + height <= window.innerHeight - margin;
      const top = Math.max(margin, Math.min(below ? box.bottom : box.top - height, window.innerHeight - height - margin));
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onDismiss]);

  return createPortal(
    <div
      ref={ref}
      className={className}
      data-testid={testId}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
