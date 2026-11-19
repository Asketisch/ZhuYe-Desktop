import { useCallback, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/logic/modals/confirm';
import { displayTitle } from './buckets';
import { useCollapsedGroups } from './useCollapsedGroups';
import type { ReflectSessionInfo } from '@/utils/commands';
import type { WorkspaceSessionGroup } from './workspaceGroups';
import type { SidebarViewProps } from '@/contracts/sidebar';

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
  archived?: ReflectSessionInfo[];
  onUnarchive?: (id: string) => Promise<void>;
  view: ComponentType<SidebarViewProps>;
  WorkspaceGroup: ComponentType<SidebarViewProps['WorkspaceGroup'] extends ComponentType<infer P> ? P : never>;
  SessionItem: ComponentType<SidebarViewProps['SessionItem'] extends ComponentType<infer P> ? P : never>;
}

const PINNED_GROUP_KEY = '__pinned__';

export function SidebarBinding(props: SidebarBindingProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toggle, isCollapsed } = useCollapsedGroups();
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
  const hasSelectableSessions = Boolean(props.onDelete) && (Boolean(pinnedGroup) || props.groups.some((group) => group.sessions.length > 0));
  const View = props.view;
  return <View {...props} t={t} query={query} searching={searching} pinnedGroup={pinnedGroup} filtered={filtered}
    showEmpty={!props.loading && filtered.length === 0 && !pinnedGroup && !props.error}
    hasSelectableSessions={hasSelectableSessions} selectMode={selectMode} selectedIds={selectedIds}
    archivedOpen={archivedOpen} isCollapsed={isCollapsed} onQueryChange={setQuery}
    onEnterSelect={() => setSelectMode(true)} onExitSelect={exitSelectMode}
    onDeleteSelected={() => { void deleteSelected(); }} onToggleSelect={toggleSelected}
    onToggleArchived={() => setArchivedOpen((value) => !value)} onToggleGroup={toggle} />;
}
