import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/logic/modals/confirm';
import { displayTitle } from './buckets';
import { useCollapsedGroups } from './useCollapsedGroups';
import type { ZhuyeSessionInfo } from '@/utils/commands';
import type { WorkspaceSessionGroup } from './workspaceGroups';
import type { SidebarViewProps } from '@/contracts/sidebar';
import type { SessionBadge } from '@/contracts/shell';

export interface SidebarBindingProps {
  groups: WorkspaceSessionGroup[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  currentWorkspace: string | null;
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
  pinnedIds?: readonly string[];
  onTogglePin?: (id: string) => void;
  archived?: ZhuyeSessionInfo[];
  /** harness 会话徽标（透传给视图）。 */
  badges?: Record<string, SessionBadge>;
  onUnarchive?: (id: string) => Promise<void>;
  view: ComponentType<SidebarViewProps>;
  WorkspaceGroup: ComponentType<SidebarViewProps['WorkspaceGroup'] extends ComponentType<infer P> ? P : never>;
  SessionItem: ComponentType<SidebarViewProps['SessionItem'] extends ComponentType<infer P> ? P : never>;
  SessionMenu: SidebarViewProps['SessionMenu'];
}

const PINNED_GROUP_KEY = '__pinned__';

export function SidebarBinding(props: SidebarBindingProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // harness 侧栏交互：内联搜索 / 仅看待处理 / 会话 ⋯ 菜单 / 计时。
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  // v1.12:子会话折叠态(>3 默认折叠,展开集合本地 UI 态)。
  const [expandedSubs, setExpandedSubs] = useState<ReadonlySet<string>>(new Set());
  const toggleSubExpand = useCallback((sessionId: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // 菜单所在副本:同一会话在分组区与平铺区各有一行,菜单只挂被点的那份。
  const [menuScope, setMenuScope] = useState<'all' | 'group'>('all');
  const openMenu = useCallback((id: string | null, scope: 'all' | 'group' = 'all') => {
    setMenuFor(id);
    setMenuScope(scope);
  }, []);
  // 行内重命名的所在副本 —— 输入框(autoFocus)只挂一份,双份会让第二个
  // 抢走焦点、第一个 blur 触发提交,重命名框闪退。
  const [renameScope, setRenameScope] = useState<'all' | 'group'>('all');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  const { toggle, isCollapsed } = useCollapsedGroups();

  // 运行中会话存在时每秒推进一次计时基准（渲染层纯展示，只能拿数值）。
  useEffect(() => {
    const anyRunning = Object.values(props.badges ?? {}).some((badge) => badge.dot === 'run');
    if (!anyRunning) return;
    const id = window.setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [props.badges]);

  // 会话 ⋯ 菜单动作：对当前 menuFor 的会话闭包（重命名为行内编辑，确认框在逻辑层）。
  // 置顶会话是 groups 会话的子集，groups 查找即覆盖全部行。
  const menuSession = useMemo(() => {
    if (!menuFor) return null;
    return props.groups.flatMap((g) => g.sessions)
      .find((s) => s.session_id === menuFor) ?? null;
  }, [menuFor, props.groups]);
  const menuActions = useMemo<SidebarViewProps['menuActions']>(() => {
    if (!menuSession) return [];
    const actions: SidebarViewProps['menuActions'] = [];
    const close = () => setMenuFor(null);
    if (props.onRename) {
      actions.push({
        key: 'rename', label: t('threads.rename'),
        run: () => {
          close();
          setRenameValue(displayTitle(menuSession) || '');
          setRenameScope(menuScope);
          setRenameId(menuSession.session_id);
        },
      });
    }
    if (props.onGenerateTitle) {
      actions.push({
        key: 'aiRename', label: t('threads.aiRename'),
        run: () => { close(); void props.onGenerateTitle?.(menuSession.session_id); },
      });
    }
    if (props.onFork) {
      actions.push({
        key: 'fork', label: t('threads.fork'),
        run: () => { close(); void props.onFork?.(menuSession.session_id, `${displayTitle(menuSession) || 'session'}-fork`); },
      });
    }
    if (props.onExport) {
      actions.push({
        key: 'export', label: t('threads.export'),
        run: () => { close(); void props.onExport?.(menuSession.session_id); },
      });
    }
    if (props.onTogglePin) {
      const pinned = props.pinnedIds?.includes(menuSession.session_id) ?? false;
      actions.push({
        key: 'pin', label: pinned ? t('harness.sb.unpin') : t('harness.sb.pin'),
        run: () => { close(); props.onTogglePin?.(menuSession.session_id); },
      });
    }
    if (props.onArchive) {
      actions.push({
        key: 'archive', label: t('threads.archive'),
        run: () => {
          close();
          // Tauri WKWebView 里 window.confirm 不可用 —— 归档也走应用内确认框。
          void confirmDialog({
            title: t('threads.archive'),
            message: t('sidebar.deleteConfirm'),
            confirmLabel: t('common.confirm'),
          }).then((ok) => { if (ok) void props.onArchive?.(menuSession.session_id); });
        },
      });
    }
    if (props.onDelete) {
      actions.push({
        key: 'delete', label: t('threads.delete'),
        run: () => {
          close();
          void confirmDialog({
            title: t('threads.delete'),
            message: t('sidebar.deleteConfirm'),
            confirmLabel: t('common.delete'),
          }).then((ok) => { if (ok) void props.onDelete?.(menuSession.session_id); });
        },
      });
    }
    return actions;
  }, [menuSession, menuScope, props.onRename, props.onGenerateTitle, props.onFork, props.onExport,
    props.onTogglePin, props.pinnedIds, props.onArchive, props.onDelete, t]);

  useEffect(() => {
    if (!menuFor) return;
    const onDoc = (e: MouseEvent) => {
      const menu = document.querySelector('[data-testid="harness-session-menu"]');
      if (menu?.contains(e.target as Node)) return;
      if ((e.target as Element | null)?.closest?.('[data-session-more]')) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const toggleSelected = useCallback((id: string) => setSelectedIds((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelectedIds(new Set()); }, []);
  const deleteSelected = useCallback(async () => {
    if (!props.onDelete || selectedIds.size === 0) return;
    const ok = await confirmDialog({ title: t('threads.deleteSelected'), message: t('threads.deleteSelectedConfirm', { n: String(selectedIds.size) }), confirmLabel: t('common.delete') });
    if (!ok) return;
    for (const id of selectedIds) await props.onDelete(id);
    exitSelectMode();
  }, [exitSelectMode, props.onDelete, selectedIds, t]);
  const searching = query.trim().length > 0; const q = query.trim().toLowerCase();
  const pinnedGroup = useMemo<WorkspaceSessionGroup | null>(() => {
    if (!props.pinnedIds?.length) return null;
    const byId = new Map(props.groups.flatMap((group) => group.sessions).map((session) => [session.session_id, session]));
    const sessions = props.pinnedIds.map((id) => byId.get(id)).filter((session): session is NonNullable<typeof session> => Boolean(session))
      .filter((session) => !searching || displayTitle(session).toLowerCase().includes(q) || session.session_id.toLowerCase().includes(q));
    return sessions.length ? { path: '', key: PINNED_GROUP_KEY, label: t('sidebar.pinned'), sessions, lastActivity: 0 } : null;
  }, [props.groups, props.pinnedIds, q, searching, t]);
  const filtered = useMemo(() => {
    const isPinned = (id: string) => props.pinnedIds?.includes(id) ?? false;
    const base = props.groups.map((group) => ({ ...group, sessions: group.sessions.filter((session) => !isPinned(session.session_id)) }));
    if (!searching) return base;
    return base.map((group) => ({ ...group, sessions: group.sessions.filter((session) => displayTitle(session).toLowerCase().includes(q) || session.session_id.toLowerCase().includes(q)) }))
      .filter((group) => group.sessions.length > 0 || group.label.toLowerCase().includes(q));
  }, [props.groups, props.pinnedIds, q, searching]);
  // 「会话」区:全部会话平铺(各组展平 —— filtered 已剔置顶与搜索过滤),
  // 按最近活跃倒序,子代理会话仍挂各自父行。
  const allSessions = useMemo(
    () => [...filtered.flatMap((group) => group.sessions)]
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)),
    [filtered],
  );
  const hasSelectableSessions = Boolean(props.onDelete) && (Boolean(pinnedGroup) || props.groups.some((group) => group.sessions.length > 0));
  const View = props.view;
  return <View {...props} t={t} query={query} searching={searching} pinnedGroup={pinnedGroup} filtered={filtered} allSessions={allSessions}
    showEmpty={!props.loading && allSessions.length === 0 && !pinnedGroup && !props.error}
    hasSelectableSessions={hasSelectableSessions} selectMode={selectMode} selectedIds={selectedIds}
    archivedOpen={archivedOpen} isCollapsed={isCollapsed} onQueryChange={setQuery}
    onEnterSelect={() => setSelectMode(true)} onExitSelect={exitSelectMode}
    onDeleteSelected={() => { void deleteSelected(); }} onToggleSelect={toggleSelected}
    onToggleArchived={() => setArchivedOpen((value) => !value)} onToggleGroup={toggle}
    menuFor={menuFor} onOpenMenu={openMenu} menuScope={menuScope}
    menuActions={menuActions} renameId={renameId} renameScope={renameScope} renameValue={renameValue} onRenameValueChange={setRenameValue}
    onCancelRename={() => setRenameId(null)} onSubmitRename={() => {
      const name = renameValue.trim();
      if (renameId && name) void props.onRename?.(renameId, name);
      setRenameId(null);
    }}
    searchOpen={searchOpen} onToggleSearch={() => setSearchOpen((value) => !value)}
    pendingOnly={pendingOnly} onTogglePendingOnly={() => setPendingOnly((value) => !value)}
    subSessionsFold={{ expanded: expandedSubs, toggle: toggleSubExpand }}
    elapsedNow={elapsedNow} />;
}
