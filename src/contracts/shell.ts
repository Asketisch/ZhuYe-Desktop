import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { TitleBar } from '@/features/shell/TitleBar';
import type { Sidebar } from '@/features/sessions/components/Sidebar';
import type { CommandPalette } from '@/features/command-palette/CommandPalette';
import type { ModalStack } from '@/features/modals';
import type { Toast as ToastView } from '@/features/design-system';
import type { Toast } from '@/stores/agent/types';
import type { DockMode, InboxTab } from '@/stores/shellUi';

/** 主区视图形态：由当前路由推导，驱动壳层样式与「更多」菜单高亮。 */
export type ShellViewMode = 'home' | 'conv' | 'plan' | 'market' | 'lanes' | 'page';

/** 会话行徽标：状态点 + 待办标记（计划待批准 / 提问待回答）。 */
export interface SessionBadge {
  /** 状态点：运行中 / 等待处理 / 出错 / 空闲 / 等待回答。 */
  dot: 'run' | 'wait' | 'err' | 'idle' | 'q';
  /** 会话级待办（侧栏旗标 + 任务中心卡片）。 */
  pending: 'plan' | 'ask' | null;
  /** 后台完成但未查看的产出。 */
  unread: boolean;
}

/** 「更多」导航菜单项。 */
export interface HarnessNavItem {
  label: string;
  path: string;
}

/**
 * harness 壳层数据包：ShellBinding 组装，视图层只负责渲染。
 * 分组传出（titlebar / sidebar / nav / dock / inbox）而不是平铺上百个 props。
 */
export interface HarnessData {
  /** i18n 文案函数（渲染层禁 import utils/i18n，由绑定层注入）。 */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** 当前路由对应的视图形态。 */
  viewMode: ShellViewMode;
  /** 标题条主标题（工作区名 / 路径尾段）。 */
  workspaceLabel: string;
  /** 侧栏「更多」菜单的页面清单。 */
  morePages: HarnessNavItem[];
  /** 路由跳转。 */
  navigate: (to: string) => void;
  /** 打开设置弹窗。 */
  openSettings: () => void;
  /** 侧栏「更多」菜单（状态在 shellUi，外部关闭监听在 ShellBinding）。 */
  moreMenuOpen: boolean;
  onToggleMoreMenu: () => void;
  onCloseMoreMenu: () => void;
  /** 每会话徽标（运行态 / 待办 / 未读）。 */
  badges: Record<string, SessionBadge>;
  /** 待处理会话数（任务中心角标）。 */
  pendingCount: number;
  /** 运行中的会话数。 */
  runningCount: number;
}

export interface ShellSlots {
  TitleBar: ComponentType<ComponentProps<typeof TitleBar>>;
  Sidebar: ComponentType<ComponentProps<typeof Sidebar>>;
  CommandPalette: ComponentType<ComponentProps<typeof CommandPalette>>;
  ModalStack: ComponentType<ComponentProps<typeof ModalStack>>;
  Toast: ComponentType<ComponentProps<typeof ToastView>>;
  Inspector: ComponentType;
  ConfirmDialogHost: ComponentType;
  ViewErrorBoundary: ComponentType<{ children: ReactNode }>;
  /** harness 扩展槽位 */
  DockPanel: ComponentType;
  /** 右 dock 左缘的拖拽分隔条（宽度可调）。 */
  DockResizer: ComponentType;
  TerminalDock: ComponentType;
  InboxPanel: ComponentType<{ inboxTab: InboxTab; onNavigateSession: (id: string) => void }>;
  SettingsHost: ComponentType<{ open: boolean; onClose: () => void }>;
}

export interface ShellViewProps {
  titleBar: ComponentProps<typeof TitleBar>;
  sidebar: ComponentProps<typeof Sidebar>;
  palette: ComponentProps<typeof CommandPalette>;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  sidebarLabel: string;
  inspectorLabel: string;
  suppressInteraction: boolean;
  toasts: Toast[];
  onDismissToast: (id: string) => void;
  onOpenUpdates: () => void;
  content: ReactNode;
  slots: ShellSlots;
  /** harness 壳层数据与 UI 状态。 */
  harness: {
    data: HarnessData;
    rail: boolean;
    onToggleRail: () => void;
    dockOpen: boolean;
    dockMode: DockMode;
    dockWide: boolean;
    onSetDockMode: (mode: DockMode) => void;
    onToggleDockWide: () => void;
    onToggleDock: () => void;
    termOpen: boolean;
    onToggleTerm: () => void;
    inboxOpen: boolean;
    inboxTab: InboxTab;
    onToggleInbox: () => void;
    onCloseInbox: () => void;
    onOpenInbox: (tab?: InboxTab) => void;
    settingsOpen: boolean;
    onCloseSettings: () => void;
    semantic: 'on' | 'off';
    onToggleSemantic: () => void;
  };
}
