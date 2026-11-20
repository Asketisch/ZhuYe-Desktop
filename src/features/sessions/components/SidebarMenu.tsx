/** 会话菜单挂到窗口层，避开侧栏滚动容器裁切。 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SidebarMenuAction } from '@/contracts/sidebar';

export function SidebarMenu({ sessionId, actions, onClose }: {
  sessionId: string;
  actions: SidebarMenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-session-more]'))
      .find((element) => element.dataset.sessionMore === sessionId);
    const menu = ref.current;
    if (!anchor || !menu) { onClose(); return; }
    const place = () => {
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
    // 滚动可能隐藏锚点；关闭菜单，避免其漂浮在无关行上。
    const onScroll = (event: Event) => { if (!menu.contains(event.target as Node)) onClose(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [sessionId, actions, onClose]);

  return createPortal(
    <div ref={ref} className="sess-menu" data-testid="harness-session-menu"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      {actions.map((action) => <button key={action.key} type="button" onClick={action.run}>{action.label}</button>)}
    </div>, document.body,
  );
}
