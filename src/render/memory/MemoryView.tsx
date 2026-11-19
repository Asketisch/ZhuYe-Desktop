/**
 * Memory —— 持久记忆面板：过滤、新增、编辑、分段与会话笔记。
 */
import { Brain, Plus, X, ShieldAlert } from 'lucide-react';
import type { MemoryViewProps } from '@/contracts/memory';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';
import { Spinner } from '../design-system/Spinner';
import { MemoryRow } from './MemoryRow';
import { MemoryAddForm } from './MemoryAddForm';
import { SessionNotesView } from './SessionNotesView';
import s from './MemoryView.module.css';

export function MemoryView({ t, scopeWarning, filters, activeFilter, counts, showForm, canAdd,
  newScope, newKey, newValue, loading, error, entries, editKey, editValue, isMutating,
  orphanDrafts, sections, injectBudget, usedChars, notesSessions, notes, notesPicked,
  notesLoading, notesError, memorySectionsError, entryKey, onFilter, onToggleForm, onNewScope,
  onNewKey, onNewValue, onSubmitNew, onBeginEdit, onChangeEdit, onSaveEdit, onCancelEdit,
  onRemove, onDiscardDraft, onPickNotesSession }: MemoryViewProps) {
  return (
    <PageShell icon={Brain} title={t('memory.title')} subtitle={t('memory.subtitle')} width="lg">
      {scopeWarning && (
        <Card level="flat" padding="sm" className={s.scopeWarning} data-testid="memory-scope-warning">
          <Icon icon={ShieldAlert} size={12} />
          <span>{scopeWarning}</span>
        </Card>
      )}

      <div className={s.filterBar}>
        {filters.map((scope) => (
          <button key={scope} type="button" className={s.filterBtn}
            data-active={activeFilter === scope || undefined}
            onClick={() => onFilter(scope)} data-testid={`memory-filter-${scope}`}>
            {t(scope === 'all' ? 'memory.scope.all' : scope === 'user' ? 'memory.scope.user' : 'memory.scope.project')}{' '}
            <span className={s.count}>{counts[scope as keyof MemoryViewProps['counts']] ?? 0}</span>
          </button>
        ))}
        <button type="button" className={s.addBtn} onClick={onToggleForm} disabled={!canAdd} data-testid="memory-add-btn">
          {showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />}{' '}
          {showForm ? t('memory.cancel') : t('memory.add')}
        </button>
      </div>

      {showForm && (
        <MemoryAddForm t={t} newScope={newScope} newKey={newKey} newValue={newValue}
          setNewScope={onNewScope} setNewKey={onNewKey} setNewValue={onNewValue}
          onSubmit={onSubmitNew} isMutating={isMutating} />
      )}

      {loading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : error ? (
        <Card level="flat" padding="none"><EmptyState icon={<Icon icon={Brain} />} title={t('memory.failed')} description={t('memory.failedDesc')} /></Card>
      ) : entries.length === 0 ? (
        <Card level="flat" padding="none"><EmptyState icon={<Icon icon={Brain} />} title={t('memory.empty')} description={t('memory.emptyDesc')} /></Card>
      ) : (
        <div className={s.list} data-testid="memory-list">
          {entries.map((entry) => (
            <MemoryRow key={entryKey(entry)} entryKey={entryKey} t={t} entry={entry} isEditing={editKey === entryKey(entry)}
              editValue={editValue} isMutating={isMutating}
              onEdit={() => onBeginEdit(entry)} onChangeEdit={onChangeEdit}
              onSave={() => onSaveEdit(entry)} onCancel={onCancelEdit} onRemove={() => onRemove(entry)} />
          ))}
        </div>
      )}

      {orphanDrafts.length > 0 && (
        <div data-testid="memory-orphan-draft">
          <p className={s.empty}>{t('memory.editMissing')}</p>
          {orphanDrafts.map((draft) => (
            <MemoryRow key={entryKey(draft.entry)} entryKey={entryKey} t={t} entry={draft.entry} isEditing={editKey === entryKey(draft.entry)}
              hasDraft removeTitle={t('memory.discardDraft')} editValue={editValue} isMutating={isMutating}
              onEdit={() => onBeginEdit(draft.entry)} onChangeEdit={onChangeEdit}
              onSave={() => onSaveEdit(draft.entry)} onCancel={onCancelEdit} onRemove={() => onDiscardDraft(draft.entry)} />
          ))}
        </div>
      )}

      <SessionNotesView t={t} sessions={notesSessions} notes={notes} picked={notesPicked}
        loading={notesLoading} error={notesError} onPick={onPickNotesSession} />

      {memorySectionsError && <Card level="flat" padding="sm" className={s.notesSection}><p className={s.empty}>{t('memory.sections.failed')}</p></Card>}

      {sections.length > 0 && (
        <section className={s.notesSection} data-testid="memory-sections">
          <h3 className={s.notesTitle}>
            {t('memory.sections.title')}
            {injectBudget > 0 && <span className={s.notesTitle}>{t('memory.sections.budget', { used: usedChars.toLocaleString(), total: injectBudget.toLocaleString() })}</span>}
          </h3>
          <ul className={s.notesList}>
            {sections.map((sec, index) => (
              <li key={`${sec.scope}-${sec.index}-${index}`} className={s.noteItem}>
                <span className={s.noteTime}>{sec.scope}{sec.title ? ` · ${sec.title}` : ''}</span>
                <span className={s.noteText}>{sec.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
