import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeSessionInfo } from '@/utils/commands';
import type { WorkspaceSessionGroup } from '@/logic/sessions/workspaceGroups';
import type { WorkspaceGroupProps } from '@/features/sessions/components/WorkspaceGroup';
import type { SessionItemProps } from '@/features/sessions/components/SessionItem';
import type { SessionBadge } from './shell';

/** 会话 ⋯ 菜单动作（回调由绑定层闭包，视图只渲染）。 */
export interface SidebarMenuAction {
  key: string;
  label: string;
  run: () => void;
}

export interface SidebarViewProps {
  t: I18nContextValue['t'];
  groups: WorkspaceSessionGroup[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  currentWorkspace: string | null;
  query: string;
  searching: boolean;
  pinnedGroup: WorkspaceSessionGroup | null;
  filtered: WorkspaceSessionGroup[];
  showEmpty: boolean;
  hasSelectableSessions: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  archivedOpen: boolean;
  pinnedIds?: readonly string[];
  archived?: ZhuyeSessionInfo[];
  /** harness 会话徽标（运行态点 / 待办旗标 / 未读），键为会话 id。 */
  badges?: Record<string, SessionBadge>;
  /** ===== harness 侧栏交互（状态由 SidebarBinding 持有，视图保持纯展示）===== */
  /** 会话 ⋯ 菜单当前打开的会话 id（null = 关闭）。 */
  menuFor: string | null;
  onOpenMenu: (id: string | null) => void;
  /** 当前打开菜单的会话动作清单（重命名 / AI 改名 / fork / 导出 / 置顶 / 归档 / 删除）。 */
  menuActions: SidebarMenuAction[];
  SessionMenu: ComponentType<{ sessionId: string; actions: SidebarMenuAction[]; onClose: () => void }>;
  renameId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  /** 内联搜索框开关。 */
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** 仅看待处理会话。 */
  pendingOnly: boolean;
  onTogglePendingOnly: () => void;
  /** 计时基准（运行中会话的耗时随此值推进；绑定层每秒 +1）。 */
  elapsedNow: number;
  isCollapsed: (key: string) => boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onNewChat?: () => void;
  onNewChatIn?: (path: string) => void;
  onRemoveWorkspace?: (path: string) => void;
  onRename?: (id: string, newName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<string | null>;
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  onOpenProject?: () => void;
  onTogglePin?: (id: string) => void;
  onUnarchive?: (id: string) => Promise<void>;
  onQueryChange: (value: string) => void;
  onEnterSelect: () => void;
  onExitSelect: () => void;
  onDeleteSelected: () => void;
  onToggleSelect: (id: string) => void;
  onToggleArchived: () => void;
  onToggleGroup: (key: string) => void;
  WorkspaceGroup: ComponentType<WorkspaceGroupProps>;
  SessionItem: ComponentType<SessionItemProps>;
}
