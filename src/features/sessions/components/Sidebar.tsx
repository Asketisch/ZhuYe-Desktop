/**
 * Sidebar —— 会话列表容器（CSS Modules 版）。
 *
 * 顶部：New Chat 主按钮 + 搜索框。
 * 主体：
 * - 置顶区（v1.x P1）：localStorage 置顶的会话成组置顶（对标 ZCode「已置顶」），
 *   已从下方项目分组中摘除，避免重复出现。
 * - 项目目录分组 session 列表（WorkspaceGroup，可折叠）。
 *   每组头部显示项目目录名（basename，hover 显全路径），组下是该项目的会话；
 *   未归属旧会话归入「未归属」分组（默认折叠）。
 *   无会话的已知项目（workspaces.json 历史）也显示，组头「+」可直接在该项目新建会话。
 * - 搜索匹配会话标题 / session id / 项目名；搜索时强制展开所有命中分组。
 * - 归档区（v1.x P1，可折叠）：底部列出已归档会话，菜单「恢复」走 unarchive。
 * - 多选模式（v1.x）：头部「多选」进入 → 行首勾选 → 选择条批量删除
 *   （逐条复用 onDelete，语义同 ThreadsView）→「完成」退出。
 * 传入 onRename/onDelete/onExport/onArchive 时，行尾出现 kebab 菜单
 * （pin / rename / export / archive / delete）。
 *
 * 契约（Sidebar.test.tsx）：
 *   - 含 'Sessions' 标题文字
 *   - 空态显示 'No sessions yet'
 *   - loading 显示 'Loading'
 *   - error 直接渲染文案
 *   - refresh 按钮带 title="Refresh"
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Archive,
  ChevronRight,
  FolderOpen,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Icon, IconButton, Button, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/features/modals/ConfirmDialog';
import { displayTitle } from '../utils/buckets';
import type { ReflectSessionInfo } from '@/utils/commands';
import type { WorkspaceSessionGroup } from '../utils/workspaceGroups';
import { useCollapsedGroups } from '../hooks/useCollapsedGroups';
import { WorkspaceGroup } from './WorkspaceGroup';
import { SessionItem } from './SessionItem';
import s from './Sidebar.module.css';

/** 置顶分组 key（与折叠态持久化共用命名空间）。 */
const PINNED_GROUP_KEY = '__pinned__';

interface Props {
  /** 项目目录分组（`useSessions().groups`）。 */
  groups: WorkspaceSessionGroup[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** 当前激活工作区绝对路径；对应分组头部标记「当前」。 */
  currentWorkspace: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onNewChat?: () => void;
  /** 在指定项目目录下新建会话（组头「+」）。 */
  onNewChatIn?: (path: string) => void;
  onRemoveWorkspace?: (path: string) => void;
  /** 行级操作（可选）；透传给 SessionItem 的 kebab 菜单。 */
  onRename?: (id: string, newName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<string | null>;
  /** fork 历史会话为子会话（可选）；透传给 SessionItem。 */
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  /** 「打开项目…」—— 调起系统目录选择器切换工作区（可选）。 */
  onOpenProject?: () => void;
  /** 置顶 id 列表（有序）与切换（可选；未接时无置顶区、菜单无置顶项）。 */
  pinnedIds?: readonly string[];
  onTogglePin?: (id: string) => void;
  /** 已归档会话与恢复（可选；未接时无归档区）。 */
  archived?: ReflectSessionInfo[];
  onUnarchive?: (id: string) => Promise<void>;
}

export function Sidebar({
  groups,
  loading,
  error,
  activeId,
  currentWorkspace,
  onSelect,
  onRefresh,
  onNewChat,
  onNewChatIn,
  onRemoveWorkspace,
  onRename,
  onDelete,
  onExport,
  onFork,
  onArchive,
  onGenerateTitle,
  onOpenProject,
  pinnedIds,
  onTogglePin,
  archived,
  onUnarchive,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const { toggle, isCollapsed } = useCollapsedGroups();

  // 多选删除：勾选若干会话后批量删除（逐条走 onDelete —— AppShell 的
  // handler 已含 remove + 取消置顶 + 当前会话退出语义，无线格式变更）。
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleDeleteSelected = async () => {
    if (!onDelete || selectedIds.size === 0) return;
    // window.confirm 在 Tauri WKWebView 不弹窗且恒返回 false，必须走应用内确认。
    const ok = await confirmDialog({
      title: t('threads.deleteSelected'),
      message: t('threads.deleteSelectedConfirm', { n: String(selectedIds.size) }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    for (const id of selectedIds) {
      await onDelete(id);
    }
    exitSelectMode();
  };

  const searching = query.trim().length > 0;
  const q = query.trim().toLowerCase();

  // 置顶组：按置顶顺序取存在的会话（删除/归档的 id 自动消失）。
  const pinnedGroup = useMemo<WorkspaceSessionGroup | null>(() => {
    if (!pinnedIds || pinnedIds.length === 0) return null;
    const byId = new Map(groups.flatMap((g) => g.sessions).map((sess) => [sess.session_id, sess]));
    const sessions = pinnedIds
      .map((id) => byId.get(id))
      .filter((sess): sess is NonNullable<typeof sess> => Boolean(sess))
      .filter((sess) => !searching || displayTitle(sess).toLowerCase().includes(q) || sess.session_id.toLowerCase().includes(q));
    if (sessions.length === 0) return null;
    return { path: '', key: PINNED_GROUP_KEY, label: t('sidebar.pinned'), sessions, lastActivity: 0 };
  }, [groups, pinnedIds, searching, q, t]);

  // 常规分组：置顶会话已上移，从项目分组中摘除；搜索沿用原过滤规则。
  const filtered = useMemo(() => {
    const isPinned = (id: string) => pinnedIds?.includes(id) ?? false;
    const base = groups.map((g) => ({
      ...g,
      sessions: g.sessions.filter((sess) => !isPinned(sess.session_id)),
    }));
    if (!searching) return base;
    return base
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter(
          (sess) =>
            displayTitle(sess).toLowerCase().includes(q) ||
            sess.session_id.toLowerCase().includes(q),
        ),
      }))
      // 会话命中或项目名命中（空项目组也能被项目名搜到）。
      .filter((g) => g.sessions.length > 0 || g.label.toLowerCase().includes(q));
  }, [groups, pinnedIds, query, searching, q]);

  const showEmpty = !loading && filtered.length === 0 && !pinnedGroup && !error;

  // 多选入口仅在提供 onDelete 且列表非空时出现（与 kebab 菜单同依赖）。
  const hasSelectableSessions =
    Boolean(onDelete) && (Boolean(pinnedGroup) || groups.some((g) => g.sessions.length > 0));

  return (
    <div className={s.root}>
      <div className={s.header}>
        <h3 className={s.title}>{t('sidebar.sessions')}</h3>
        <div className={s.headerActions}>
          {selectMode ? (
            <div className={s.selectBar} data-testid="sidebar-select-bar">
              <span className={s.selectedCount} data-testid="sidebar-selected-count">
                {t('threads.selectedCount', { n: String(selectedIds.size) })}
              </span>
              <IconButton
                label={t('threads.deleteSelected')}
                disabled={selectedIds.size === 0}
                onClick={() => void handleDeleteSelected()}
                data-testid="sidebar-delete-selected"
                size="sm"
              >
                <Icon icon={Trash2} size={14} />
              </IconButton>
              <IconButton label={t('threads.exitSelect')} onClick={exitSelectMode} size="sm">
                <Icon icon={X} size={14} />
              </IconButton>
            </div>
          ) : (
            <>
              {hasSelectableSessions && (
                <IconButton
                  label={t('threads.select')}
                  onClick={() => setSelectMode(true)}
                  size="sm"
                  data-testid="sidebar-select-mode"
                >
                  <Icon icon={ListChecks} size={14} />
                </IconButton>
              )}
              <IconButton label={t('sidebar.refresh')} onClick={onRefresh} disabled={loading} size="sm">
                <Icon icon={RefreshCw} size={14} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <div className={s.actions}>
        <Button variant="primary" block size="sm" onClick={onNewChat} leftIcon={<Icon icon={Plus} size={14} />}>
          {t('sidebar.newChat')}
        </Button>
        <Input
          size="sm"
          leading={<Icon icon={Search} size={13} />}
          placeholder={t('sidebar.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('sidebar.searchAriaLabel')}
        />
      </div>

      <div className={s.list}>
        {error && <p className={s.error}>{error}</p>}
        {loading && filtered.length === 0 && !pinnedGroup && <p className={s.hint}>{t('sidebar.loading')}</p>}
        {showEmpty && <p className={s.hint}>{t('sidebar.empty')}</p>}
        {pinnedGroup && (
          <WorkspaceGroup
            key={pinnedGroup.key}
            group={pinnedGroup}
            activeId={activeId}
            open={searching ? true : !isCollapsed(pinnedGroup.key)}
            isCurrentWorkspace={false}
            onToggle={toggle}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onFork={onFork}
            onArchive={onArchive}
            onGenerateTitle={onGenerateTitle}
            pinnedIds={pinnedIds}
            onTogglePin={onTogglePin}
            selectable={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
          />
        )}
        {filtered.map((g) => (
          <WorkspaceGroup
            key={g.key}
            group={g}
            activeId={activeId}
            open={searching ? true : !isCollapsed(g.key)}
            isCurrentWorkspace={g.path !== null && g.path === currentWorkspace}
            onToggle={toggle}
            onNewChatIn={onNewChatIn}
            onRemoveWorkspace={onRemoveWorkspace}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onFork={onFork}
            onArchive={onArchive}
            onGenerateTitle={onGenerateTitle}
            pinnedIds={pinnedIds}
            onTogglePin={onTogglePin}
            selectable={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
          />
        ))}

        {archived && archived.length > 0 && (
          <section className={s.archivedSection} data-testid="sidebar-archived">
            <button
              type="button"
              className={s.archivedToggle}
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen((v) => !v)}
            >
              <Icon icon={ChevronRight} size={12} className={archivedOpen ? s.chevronOpen : undefined} />
              <Icon icon={Archive} size={12} />
              <span>{t('threads.archived')}</span>
              <span className={s.archivedCount}>{archived.length}</span>
            </button>
            {archivedOpen && (
              <div className={s.archivedItems}>
                {archived.map((sess) => (
                  <SessionItem
                    key={sess.session_id}
                    session={sess}
                    active={false}
                    showWorkspace
                    onClick={() => onSelect(sess.session_id)}
                    onRename={onRename}
                    onDelete={onDelete}
                    onExport={onExport}
                    onArchive={onUnarchive}
                    archivedRow
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {onOpenProject && (
        <div className={s.footer}>
          <Button
            variant="ghost"
            block
            size="sm"
            onClick={onOpenProject}
            leftIcon={<Icon icon={FolderOpen} size={14} />}
            data-testid="sidebar-open-project"
          >
            {t('sidebar.openProject')}
          </Button>
        </div>
      )}
    </div>
  );
}
