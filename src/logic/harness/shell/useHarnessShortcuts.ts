/**
 * useHarnessShortcuts —— harness 壳层快捷键（设计稿 KEYMAP 对齐）。
 *
 * 绑定（macOS Meta / 其余平台 Ctrl）：
 *   ⌘\ 折叠侧栏      ⌘` 终端面板     ⌘I dock 开合    ⌘N 新会话(经回调)
 *   ⌘⇧B 浏览器 dock   ⌘⇧E 文件 dock   ⌘⇧S 子代理 dock  ⌘⌃C 用量 dock
 *   ⌘⇧P 插件市场      ⌘⇧A 子代理泳道  ⌘P 计划视图
 *   ⌘⇧R 任务中心      ⌘⇧M 单色模式    ⌘⇧L 亮暗主题
 * Esc 依层级关闭：任务中心 → 设置 → 命令面板（palette 的 Esc 在
 * useCommandPaletteShortcut 内处理，这里兜底其余浮层）。
 */
import { useEffect } from 'react';
import { useShellUi, type DockTabKind } from '@/stores/shellUi';
import { useThemeCycle } from './useThemeCycle';

export interface HarnessShortcutHandlers {
  /** 新会话（由 ShellBinding 传入，含工作区/查询缓存语义）。 */
  onNewSession?: () => void;
  /** 路由跳转（/plan、/market、/lanes）。 */
  onNavigate?: (to: string) => void;
}

export function useHarnessShortcuts(handlers: HarnessShortcutHandlers = {}): void {
  const ui = useShellUi();
  const { cycleTheme } = useThemeCycle();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === 'Escape' && ui.paletteOpen) {
          // palette 优先级最低：仅在自身打开时兜底（hook 内已处理，此处防御）。
          return;
        }
        if (e.key === 'Escape' && ui.inboxOpen) {
          e.preventDefault();
          ui.closeInbox();
          return;
        }
        if (e.key === 'Escape' && ui.settingsOpen) {
          e.preventDefault();
          ui.setSettingsOpen(false);
          return;
        }
        return;
      }
      const key = e.key.toLowerCase();
      const withShift = e.shiftKey;
      // ⌘`（Backquote）终端面板。
      if (key === '`') {
        e.preventDefault();
        ui.toggleTerm();
        return;
      }
      if (key === '\\') {
        e.preventDefault();
        ui.toggleRail();
        return;
      }
      if (!withShift) {
        if (key === 'i') {
          e.preventDefault();
          ui.toggleDockOpen();
        } else if (key === 'n') {
          e.preventDefault();
          handlers.onNewSession?.();
        } else if (key === 'p') {
          e.preventDefault();
          handlers.onNavigate?.('/plan');
        }
        return;
      }
      // ===== shift 组合 =====
      const dockOrNav = (kind: Exclude<DockTabKind, 'new-tab'>) => {
        e.preventDefault();
        ui.openDockTab(kind);
      };
      if (key === 'b') dockOrNav('browser');
      else if (key === 'e') dockOrNav('files');
      else if (key === 's') dockOrNav('agents');
      else if (key === 'c') dockOrNav('usage');
      else if (key === 'p') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('zhuye-navigate', { detail: '/market' }));
      } else if (key === 'a') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('zhuye-navigate', { detail: '/lanes' }));
      } else if (key === 'r') {
        e.preventDefault();
        ui.toggleInbox();
      } else if (key === 'm') {
        e.preventDefault();
        ui.toggleSemantic();
      } else if (key === 'l') {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // cycleTheme / handlers 引用变化时重挂监听（轻量）。
  }, [ui, cycleTheme, handlers]);
}
