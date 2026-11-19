import { useCallback, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useSessions, useActiveSession } from '@/logic/sessions/useSessions';
import { confirmDialog } from '@/logic/modals/confirm';
import type { ThreadsViewProps } from '@/contracts/threads';

export function ThreadsBinding({ view: View, BucketGroup }: { view: ComponentType<ThreadsViewProps>; BucketGroup: ThreadsViewProps['BucketGroup'] }) {
  const { buckets, archived, rename, fork, generateTitle, remove, archive, unarchive, export: exportSession } = useSessions();
  const { activeId, setActiveId } = useActiveSession();
  const { t, tp } = useI18n();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelectedIds(new Set()); }, []);
  const toggleSelected = useCallback((id: string) => setSelectedIds((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const deleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const ok = await confirmDialog({ title: t('threads.deleteSelected'), message: t('threads.deleteSelectedConfirm', { n: String(ids.length) }), confirmLabel: t('common.delete') });
    if (!ok) return;
    for (const id of ids) await remove(id);
    if (activeId && ids.includes(activeId)) setActiveId(null);
    exitSelectMode();
  }, [activeId, exitSelectMode, remove, selectedIds, setActiveId, t]);
  const onArchive = useCallback(async (id: string) => { await archive(id); if (id === activeId) setActiveId(null); }, [activeId, archive, setActiveId]);
  const onFork = useCallback(async (id: string, branch: string) => { const child = await fork(id, branch); setActiveId(child); return child; }, [fork, setActiveId]);
  const onDeleteArchived = useCallback(async (id: string) => {
    const ok = await confirmDialog({ title: t('threads.delete'), message: t('threads.deleteConfirm', { id }), confirmLabel: t('common.delete') });
    if (ok) await remove(id);
  }, [remove, t]);
  return <View t={t} tp={tp} buckets={buckets} archived={archived} activeId={activeId}
    selectMode={selectMode} selectedIds={selectedIds}
    onEnterSelect={() => setSelectMode(true)} onExitSelect={exitSelectMode}
    onDeleteSelected={() => { void deleteSelected(); }} onSelect={setActiveId}
    onRename={rename} onDelete={remove} onExport={exportSession} onFork={onFork}
    onArchive={onArchive} onGenerateTitle={(id) => generateTitle(id, true)}
    onToggleSelect={toggleSelected} onUnarchive={unarchive} onDeleteArchived={onDeleteArchived}
    BucketGroup={BucketGroup} />;
}
