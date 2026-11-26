import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { TitleBar } from '@/features/shell/TitleBar';
import type { Sidebar } from '@/features/sessions/components/Sidebar';
import type { CommandPalette } from '@/features/command-palette/CommandPalette';
import type { ModalStack } from '@/features/modals';
import type { Toast as ToastView } from '@/features/design-system';
import type { Toast } from '@/stores/agent/types';
import type { DockTab, DockTabKind, InboxTab } from '@/stores/shellUi';

export type { DockTab, DockTabKind } from '@/stores/shellUi';

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
  /**
   * 运行起点 epoch ms（dot === 'run' 时侧栏据此显示回合计时）。
   * `null`/缺省 = 起点未知（显示呼吸点即可，不出计时）—— 诚实缺失，
   * 不拿会话创建时间冒充回合时长（实测 bug #9：历史会话计时 25h）。
   */
  since?: number | null;
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
  /** 当前路径（侧栏 automation 入口的 active 判定）。 */
  pathname: string;
  /** 标题条主标题（工作区名 / 路径尾段）。 */
  workspaceLabel: string;
  /** 路由跳转。 */
  navigate: (to: string) => void;
  /** 打开设置弹窗。 */
  openSettings: () => void;
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
  /** 右 dock 浮层（标签总览 / 标签右键菜单），由绑定层持有锚点态后注入。 */
  DockOverlays: ComponentType<DockOverlaysProps>;
}

/** DockOverlays slot 的 props（锚点态在绑定层，动作从 dock 契约透传）。 */
export interface DockOverlaysProps {
  overviewAnchor: HTMLElement | null;
  contextMenu: { tabId: string; anchor: HTMLElement } | null;
  onToggleOverview: (anchor: HTMLElement | null) => void;
  onOpenContextMenu: (tabId: string, anchor: HTMLElement | null) => void;
  onActivateTab: (id: string) => void;
  onReopenClosedTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
}

/** 右 dock 标签页体系（对齐 ZCode side pane）。 */
export interface HarnessDock {
  tabs: DockTab[];
  activeId: string | null;
  recentlyClosedTabs: DockTab[];
  fullView: boolean;
  wide: boolean;
  /** 当前会话是否已有计划（启动器显示「计划」条目、计划标签自动展开）。 */
  hasPlan: boolean;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onReorderTab: (from: number, to: number) => void;
  onNewTab: () => void;
  onOpenTab: (kind: Exclude<DockTabKind, 'new-tab'>) => void;
  onReopenClosedTab: (id: string) => void;
  onToggleFullView: () => void;
  onToggleWide: () => void;
  onCollapse: () => void;
  /** 标签总览 / 右键菜单锚点态（绑定层持有）。 */
  overviewAnchor: HTMLElement | null;
  contextMenu: { tabId: string; anchor: HTMLElement } | null;
  /** 标签总览锚点切换（传 null = 收起）；锚点态由绑定层持有。 */
  onToggleOverview: (anchor: HTMLElement | null) => void;
  /** 标签右键菜单锚点切换。 */
  onOpenContextMenu: (tabId: string, anchor: HTMLElement | null) => void;
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
    /** v1.x dock 标签页体系（替代旧 dockMode 单选）。 */
    dock: HarnessDock;
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
