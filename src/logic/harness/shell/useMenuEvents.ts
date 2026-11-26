/**
 * 原生菜单事件 → 前端路由动作。
 *
 * 后端 `menu.rs` 把菜单点击 emit 成 `menu-<kebab>` 事件;本 hook 是它们的
 * 前端消费点（此前全部断线 —— 事件发了没人听）。目前只接了 check-updates:
 * 跳到设置页,由 UpdatesSection 挂载时的自动检查完成「触发检查」语义。
 * 其余菜单项接进来的动作落到这里追加。
 */
import { useEffect } from 'react';
import { listen } from '@/utils/bridge';

export function useMenuEvents(navigate: (to: string) => void): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen('menu-check-updates', () => {
      navigate('/settings');
    }).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, [navigate]);
}
