/**
 * WorkspaceGroup —— 侧边栏单个项目目录分组（可折叠）。
 *
 * 组头：chevron + 目录名（basename，hover `title` 显全路径）+ 会话数
 * + 当前工作区标记 + 「+」（在该项目新建会话）。
 * 点击组头主体切换折叠（aria-expanded）；「+」是独立按钮，避免嵌套交互元素。
 * 未归属分组（path === null）标题用 i18n 文案，且不显示「+」（无目录可切）。
 */
import { ChevronRight, Folder, FolderOpen, Plus, X } from 'lucide-react';
import { Icon, IconButton } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import type { WorkspaceSessionGroup } from '@/logic/sessions/workspaceGroups';
import { SessionItem } from './SessionItem';
import s from '@/render/conversation/sessions/components/WorkspaceGroup.module.css';

export interface WorkspaceGroupProps {
  group: WorkspaceSessionGroup;
  activeId: string | null;
  open: boolean;
  /** 该分组是否为当前激活工作区。 */
  isCurrentWorkspace: boolean;
  onToggle: (key: string) => void;
  /** 在该项目下新建会话；未提供或未归属分组时不显示「+」。 */
  onNewChatIn?: (path: string) => void;
  onRemoveWorkspace?: (path: string) => void;
  onSelect: (id: string) => void;
  /** 行级操作（可选）；透传给 SessionItem 的 kebab 菜单。 */
  onRename?: (id: string, newName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<string | null>;
  /** fork 历史会话为子会话（可选）；透传给 SessionItem。 */
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  /** 置顶（可选）；透传给 SessionItem。 */
  pinnedIds?: readonly string[];
  onTogglePin?: (id: string) => void;
  /** 多选删除（可选）；透传给 SessionItem。 */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
}

export function WorkspaceGroup({
  group,
  activeId,
  open,
  isCurrentWorkspace,
  onToggle,
  onNewChatIn,
  onRemoveWorkspace,
  onSelect,
  onRename,
  onDelete,
  onExport,
  onFork,
  onArchive,
  onGenerateTitle,
  pinnedIds,
  onTogglePin,
  selectable,
  selectedIds,
  onToggleSelect,
}: WorkspaceGroupProps) {
  const { t } = useI18n();
  const unassigned = group.path === null;
  const title = unassigned ? t('sidebar.group.noWorkspace') : group.label;
  const canNewChat = !unassigned && Boolean(onNewChatIn);

  return (
    <section className={s.group}>
      <div className={s.header} data-current={isCurrentWorkspace || undefined}>
        <button
          type="button"
          className={s.toggle}
          aria-expanded={open}
          aria-label={t('sidebar.group.collapseAria')}
          title={group.path ?? undefined}
          onClick={() => onToggle(group.key)}
        >
          <Icon icon={ChevronRight} size={13} className={open ? s.chevronOpen : s.chevron} />
          <Icon icon={open ? FolderOpen : Folder} size={13} className={s.folder} />
          <span className={s.label}>{title}</span>
          <span className={s.count}>{group.sessions.length}</span>
          {isCurrentWorkspace && (
            <span className={s.currentDot} role="img" aria-label={t('sidebar.group.current')} title={t('sidebar.group.current')} />
          )}
        </button>
        {canNewChat && (
          <IconButton
            label={t('sidebar.group.newChatIn')}
            size="sm"
            className={s.newChatBtn}
            onClick={() => onNewChatIn?.(group.path as string)}
          >
            <Icon icon={Plus} size={13} />
          </IconButton>
        )}
        {group.path && onRemoveWorkspace && (
          <IconButton label={t('sidebar.group.remove')} size="sm" className={s.newChatBtn}
            onClick={() => onRemoveWorkspace(group.path as string)}>
            <Icon icon={X} size={13} />
          </IconButton>
        )}
      </div>
      {open && (
        <div className={s.items}>
          {group.sessions.map((sess) => (
            <SessionItem
              key={sess.session_id}
              session={sess}
              active={activeId === sess.session_id}
              showWorkspace={false}
              onClick={() => onSelect(sess.session_id)}
              onRename={onRename}
              onDelete={onDelete}
              onExport={onExport}
              onFork={onFork}
              onArchive={onArchive}
              onGenerateTitle={onGenerateTitle}
              pinned={pinnedIds?.includes(sess.session_id)}
              onTogglePin={onTogglePin}
              selectable={selectable}
              selected={selectedIds?.has(sess.session_id) ?? false}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
