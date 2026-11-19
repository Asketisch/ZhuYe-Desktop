import { Archive, ChevronRight, FolderOpen, ListChecks, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { SidebarViewProps } from '@/contracts/sidebar';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { Button } from '../design-system/Button';
import { Input } from '../design-system/Input';
import s from './Sidebar.module.css';

export function Sidebar({ t, loading, error, activeId, currentWorkspace, query, searching,
  pinnedGroup, filtered, showEmpty, hasSelectableSessions, selectMode, selectedIds, archivedOpen,
  pinnedIds, archived, isCollapsed, onSelect, onRefresh, onNewChat, onNewChatIn, onRemoveWorkspace,
  onRename, onDelete, onExport, onFork, onArchive, onGenerateTitle, onOpenProject, onTogglePin,
  onUnarchive, onQueryChange, onEnterSelect, onExitSelect, onDeleteSelected, onToggleSelect,
  onToggleArchived, onToggleGroup, WorkspaceGroup, SessionItem }: SidebarViewProps) {
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
                onClick={onDeleteSelected}
                data-testid="sidebar-delete-selected"
                size="sm"
              >
                <Icon icon={Trash2} size={14} />
              </IconButton>
              <IconButton label={t('threads.exitSelect')} onClick={onExitSelect} size="sm">
                <Icon icon={X} size={14} />
              </IconButton>
            </div>
          ) : (
            <>
              {hasSelectableSessions && (
                <IconButton
                  label={t('threads.select')}
                  onClick={onEnterSelect}
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
          onChange={(e) => onQueryChange(e.target.value)}
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
            onToggle={onToggleGroup}
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
            onToggleSelect={onToggleSelect}
          />
        )}
        {filtered.map((g) => (
          <WorkspaceGroup
            key={g.key}
            group={g}
            activeId={activeId}
            open={searching ? true : !isCollapsed(g.key)}
            isCurrentWorkspace={g.path !== null && g.path === currentWorkspace}
            onToggle={onToggleGroup}
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
            onToggleSelect={onToggleSelect}
          />
        ))}

        {archived && archived.length > 0 && (
          <section className={s.archivedSection} data-testid="sidebar-archived">
            <button
              type="button"
              className={s.archivedToggle}
              aria-expanded={archivedOpen}
              onClick={onToggleArchived}
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
