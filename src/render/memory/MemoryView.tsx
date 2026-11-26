/**
 * Memory —— 持久记忆面板：过滤、新增、编辑、分段与会话笔记。
 *
 * 视觉走设置页套件（SettingsPage.module.css）：过滤栏 = 工具栏胶囊 +
 * 计数，列表 = 圆角行容器，空态/加载 = 套件空态。行条目（MemoryRow）
 * 与表单（MemoryAddForm）/ 会话笔记（SessionNotesView）保留原组件。
 * 测试锚点（memory-*）全部保留。
 */
import { Brain, Plus, ShieldAlert, X } from 'lucide-react';
import type { MemoryViewProps } from '@/contracts/knowledge/memory';
import { PageShell } from '../shell/PageShell';
import { Spinner } from '../design-system/Spinner';
import { MemoryRow } from './MemoryRow';
import { MemoryAddForm } from './MemoryAddForm';
import { SessionNotesView } from './SessionNotesView';
import kit from '../settings/SettingsPage.module.css';

export function MemoryView({ t, scopeWarning, filters, activeFilter, counts, showForm, canAdd,
  newScope, newKey, newValue, loading, error, entries, editKey, editValue, isMutating,
  orphanDrafts, sections, injectBudget, usedChars, notesSessions, notes, notesPicked,
  notesLoading, notesError, memorySectionsError, entryKey, onFilter, onToggleForm, onNewScope,
  onNewKey, onNewValue, onSubmitNew, onBeginEdit, onChangeEdit, onSaveEdit, onCancelEdit,
  onRemove, onDiscardDraft, onPickNotesSession }: MemoryViewProps) {
  return (
    <PageShell icon={Brain} title={t('memory.title')} subtitle={t('memory.subtitle')} width="lg">
      {scopeWarning && (
        <div className={kit.notice} data-testid="memory-scope-warning">
          <ShieldAlert size={14} strokeWidth={1.5} aria-hidden />
          <span>{scopeWarning}</span>
        </div>
      )}

      <div className={kit.toolbar}>
        {filters.map((scope) => (
          <button key={scope} type="button" className={kit.pill}
            data-active={activeFilter === scope || undefined}
            onClick={() => onFilter(scope)} data-testid={`memory-filter-${scope}`}>
            {t(scope === 'all' ? 'memory.scope.all' : scope === 'user' ? 'memory.scope.user' : 'memory.scope.project')}{' '}
            <span className={kit.dim}>{counts[scope as keyof MemoryViewProps['counts']] ?? 0}</span>
          </button>
        ))}
        <span className={kit.grow} />
        <button type="button" className={`${kit.btn} ${showForm ? kit.outline : kit.primary}`} onClick={onToggleForm} disabled={!canAdd} data-testid="memory-add-btn">
          {showForm ? <X strokeWidth={1.5} aria-hidden /> : <Plus strokeWidth={1.5} aria-hidden />}{' '}
          {showForm ? t('memory.cancel') : t('memory.add')}
        </button>
      </div>

      {showForm && (
        <MemoryAddForm t={t} newScope={newScope} newKey={newKey} newValue={newValue}
          setNewScope={onNewScope} setNewKey={onNewKey} setNewValue={onNewValue}
          onSubmit={onSubmitNew} isMutating={isMutating} />
      )}

      {loading ? (
        <div className={kit.emptyBox}><Spinner size={20} /></div>
      ) : error ? (
        <div className={kit.notice}><span>{t('memory.failed')}：{t('memory.failedDesc')}</span></div>
      ) : entries.length === 0 ? (
        <div className={kit.emptyBox}>{t('memory.empty')} —— {t('memory.emptyDesc')}</div>
      ) : (
        <div className={kit.resList} data-testid="memory-list">
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
          <p className={kit.secDesc}>{t('memory.editMissing')}</p>
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

      {memorySectionsError && <div className={kit.notice}><span>{t('memory.sections.failed')}</span></div>}

      {sections.length > 0 && (
        <section className={kit.resGroup} data-testid="memory-sections">
          <div className={kit.resHead}>
            <h3>{t('memory.sections.title')}</h3>
            {injectBudget > 0 && <span className={kit.count}>{t('memory.sections.budget', { used: usedChars.toLocaleString(), total: injectBudget.toLocaleString() })}</span>}
          </div>
          <ul className={kit.resList}>
            {sections.map((sec, index) => (
              <li key={`${sec.scope}-${sec.index}-${index}`} className={kit.resItem}>
                <div className={kit.resMain}>
                  <span className={kit.resTitle}>{sec.scope}{sec.title ? ` · ${sec.title}` : ''}</span>
                  <div className={kit.resDesc}>{sec.body}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
