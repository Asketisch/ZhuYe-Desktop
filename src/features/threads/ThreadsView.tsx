/**
 * Threads —— 线程列表（CSS Modules 版）。
 *
 * B3-03: ThreadsView 注入 rename / delete / export / archive handlers
 *        到 ThreadBucketGroup。所有 mutation 通过 useSessions → invalidate
 *        → 自动重刷。
 * 归档区：列出已归档会话（`~/.zhuye/sessions-archive`），支持恢复 /
 *        彻底删除。
 */
import { useCallback, useState } from 'react';
import { useSessions, useActiveSession } from '../sessions/hooks/useSessions';
import { ThreadBucketGroup } from './components/ThreadBucketGroup';
import { PageShell } from '@/features/shell/PageShell';
import { Card, EmptyState, Icon, Button } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/features/modals/ConfirmDialog';
import { MessagesSquare, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import s from './ThreadsView.module.css';
import { shortTimestamp } from './utils/threadLabels';

export function ThreadsView() {
  const {
    buckets,
    archived,
    rename,
    fork,
    generateTitle,
    remove,
    archive,
    unarchive,
    export: exportSession,
  } = useSessions();
  const { activeId, setActiveId } = useActiveSession();
  const { t, tp } = useI18n();

  // 多选删除：勾选若干会话后批量删除（逐条走既有 reflect_delete_session，
  // 无线格式变更）。删除含当前会话时先退出会话路由。
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
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // window.confirm 在 Tauri WKWebView 不弹窗且恒返回 false，必须走应用内确认。
    const ok = await confirmDialog({
      title: t('threads.deleteSelected'),
      message: t('threads.deleteSelectedConfirm', { n: String(ids.length) }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    for (const id of ids) {
      await remove(id);
    }
    if (activeId && ids.includes(activeId)) setActiveId(null);
    exitSelectMode();
  };

  const handleArchive = async (id: string) => {
    await archive(id);
    if (id === activeId) setActiveId(null);
  };

  return (
    <PageShell
      icon={MessagesSquare}
      title={t('threads.title')}
      width="sm"
      actions={
        selectMode ? (
          <div className={s.selectBar} data-testid="threads-select-bar">
            <span className={s.selectedCount} data-testid="threads-selected-count">
              {t('threads.selectedCount', { n: String(selectedIds.size) })}
            </span>
            <Button
              size="sm"
              variant="danger"
              disabled={selectedIds.size === 0}
              onClick={() => void handleDeleteSelected()}
              data-testid="threads-delete-selected"
            >
              {t('threads.deleteSelected')}
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelectMode}>
              {t('threads.exitSelect')}
            </Button>
          </div>
        ) : (
          buckets.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectMode(true)}
              data-testid="threads-select-mode"
            >
              {t('threads.select')}
            </Button>
          )
        )
      }
    >
      {buckets.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={MessagesSquare} />}
            title={t('threads.empty')}
            description={t('home.noRecent')}
          />
        </Card>
      ) : (
        <div className={s.list}>
          {buckets.map((b) => (
            <ThreadBucketGroup
              key={b.label}
              bucket={b}
              activeId={activeId}
              onSelect={setActiveId}
              onRename={rename}
              onDelete={remove}
              onExport={exportSession}
              onFork={async (id, branch) => {
                // fork 后直接切到子会话（路由驱动 → ChatView bind + replay）。
                const child = await fork(id, branch);
                setActiveId(child);
                return child;
              }}
              onArchive={handleArchive}
              onGenerateTitle={(id) => generateTitle(id, true)}
              selectable={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
            />
          ))}
        </div>
      )}

      <section className={s.archived} data-testid="threads-archived">
        <h3 className={s.archivedTitle}>
          <Icon icon={Archive} size={14} /> {t('threads.archived')}
          {archived.length > 0 && <span className={s.archivedCount}>{archived.length}</span>}
        </h3>
        {archived.length === 0 ? (
          <p className={s.archivedEmpty}>{t('threads.archivedEmpty')}</p>
        ) : (
          <ul className={s.archivedList}>
            {archived.map((sess) => (
              <li key={sess.session_id} className={s.archivedRow}>
                <div className={s.archivedBody}>
                  <div className={s.archivedTitleText}>
                    {sess.title || sess.session_id.slice(0, 8)}
                  </div>
                  <div className={s.archivedMeta}>
                    {shortTimestamp(sess.started_at)} ·{' '}
                    {tp('threads.msgCount', sess.message_count)}
                  </div>
                </div>
                <div className={s.archivedActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Icon icon={ArchiveRestore} size={12} />}
                    onClick={() => void unarchive(sess.session_id)}
                    data-testid={`archived-restore-${sess.session_id}`}
                  >
                    {t('threads.restore')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Icon icon={Trash2} size={12} />}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t('threads.delete'),
                        message: t('threads.deleteConfirm', { id: sess.session_id }),
                        confirmLabel: t('common.delete'),
                      });
                      if (ok) void remove(sess.session_id);
                    }}
                    data-testid={`archived-delete-${sess.session_id}`}
                  >
                    {t('threads.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
