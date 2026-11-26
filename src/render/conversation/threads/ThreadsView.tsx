import { Archive, ArchiveRestore, MessagesSquare, Trash2 } from 'lucide-react';
import type { ThreadsViewProps } from '@/contracts/conversation/threads';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import { Button } from '@/render/harness/design-system/Button';
import { Icon } from '@/render/harness/design-system/Icon';
import s from './ThreadsView.module.css';

function timestamp(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ThreadsView({ t, tp, buckets, archived, activeId, selectMode, selectedIds,
  onEnterSelect, onExitSelect, onDeleteSelected, onSelect, onRename, onDelete, onExport,
  onFork, onArchive, onGenerateTitle, onToggleSelect, onUnarchive, onDeleteArchived, BucketGroup }: ThreadsViewProps) {
  return (
    <PageShell icon={MessagesSquare} title={t('threads.title')} width="sm"
      actions={selectMode ? (
        <div className={s.selectBar} data-testid="threads-select-bar">
          <span className={s.selectedCount} data-testid="threads-selected-count">{t('threads.selectedCount', { n: String(selectedIds.size) })}</span>
          <Button size="sm" variant="danger" disabled={selectedIds.size === 0} onClick={onDeleteSelected} data-testid="threads-delete-selected">{t('threads.deleteSelected')}</Button>
          <Button size="sm" variant="ghost" onClick={onExitSelect}>{t('threads.exitSelect')}</Button>
        </div>
      ) : buckets.length > 0 ? <Button size="sm" variant="ghost" onClick={onEnterSelect} data-testid="threads-select-mode">{t('threads.select')}</Button> : null}>
      {buckets.length === 0 ? <Card level="flat" padding="none"><EmptyState icon={<Icon icon={MessagesSquare} />} title={t('threads.empty')} description={t('home.noRecent')} /></Card> : (
        <div className={s.list}>{buckets.map((bucket) => <BucketGroup key={bucket.label} bucket={bucket} activeId={activeId}
          onSelect={onSelect} onRename={onRename} onDelete={onDelete} onExport={onExport} onFork={onFork}
          onArchive={onArchive} onGenerateTitle={onGenerateTitle} selectable={selectMode}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect} />)}</div>
      )}
      <section className={s.archived} data-testid="threads-archived">
        <h3 className={s.archivedTitle}><Icon icon={Archive} size={14} /> {t('threads.archived')}{archived.length > 0 && <span className={s.archivedCount}>{archived.length}</span>}</h3>
        {archived.length === 0 ? <p className={s.archivedEmpty}>{t('threads.archivedEmpty')}</p> : (
          <ul className={s.archivedList}>{archived.map((session) => (
            <li key={session.session_id} className={s.archivedRow}>
              <div className={s.archivedBody}><div className={s.archivedTitleText}>{session.title || session.session_id.slice(0, 8)}</div>
                <div className={s.archivedMeta}>{timestamp(session.started_at)} · {tp('threads.msgCount', session.message_count)}</div></div>
              <div className={s.archivedActions}>
                <Button size="sm" variant="ghost" leftIcon={<Icon icon={ArchiveRestore} size={12} />} onClick={() => void onUnarchive(session.session_id)} data-testid={`archived-restore-${session.session_id}`}>{t('threads.restore')}</Button>
                <Button size="sm" variant="ghost" leftIcon={<Icon icon={Trash2} size={12} />} onClick={() => void onDeleteArchived(session.session_id)} data-testid={`archived-delete-${session.session_id}`}>{t('threads.delete')}</Button>
              </div>
            </li>
          ))}</ul>
        )}
      </section>
    </PageShell>
  );
}
