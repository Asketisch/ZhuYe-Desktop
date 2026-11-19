/**
 * Memory —— MemoryRow（纯展示组件）。
 */
import { Plus, Trash2, Save, X } from 'lucide-react';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import type { MemoryViewProps } from '@/contracts/memory';
import type { ReflectMemoryEntry } from '@/contracts/memory';
import s from './MemoryView.module.css';

export interface MemoryRowProps {
  t: MemoryViewProps['t'];
  entryKey: (entry: ReflectMemoryEntry) => string;
  entry: ReflectMemoryEntry;
  isEditing: boolean;
  hasDraft?: boolean;
  removeTitle?: string;
  editValue: string;
  isMutating: boolean;
  onEdit: () => void;
  onChangeEdit: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}

export function MemoryRow({ t, entryKey, entry, isEditing, hasDraft = false, removeTitle, editValue,
  isMutating, onEdit, onChangeEdit, onSave, onCancel, onRemove }: MemoryRowProps) {
  return (
    <Card level="outlined" padding="sm" className={s.row} data-testid={`memory-entry-${entry.key}`}>
      <div className={s.rowLeft}>
        <Badge variant="neutral">{entry.scope}</Badge>
        <code className={s.key}>{entry.key}</code>
        {hasDraft && <Badge variant="neutral">{t('memory.draft')}</Badge>}
      </div>
      {isEditing ? (
        <div className={s.editRow} data-testid={`memory-edit-${entryKey(entry)}`}>
          <textarea value={editValue} onChange={(event) => onChangeEdit(event.target.value)}
            className={s.editInput} rows={2} autoFocus data-testid="memory-edit-input" />
          <div className={s.editActions}>
            <button type="button" className={s.saveBtnSmall} onClick={onSave} disabled={isMutating} data-testid="memory-edit-save">
              <Icon icon={Save} size={11} /> {t('memory.save')}
            </button>
            <button type="button" className={s.cancelBtnSmall} onClick={onCancel}><Icon icon={X} size={11} /></button>
          </div>
        </div>
      ) : (
        <div className={s.rowRight}>
          <span className={s.value} title={entry.value}>{entry.value}</span>
          <div className={s.actions}>
            <button type="button" className={s.actionBtn} onClick={onEdit} title={t(hasDraft ? 'memory.resumeEdit' : 'memory.edit')}>
              <Icon icon={Plus} size={11} />
            </button>
            <button type="button" className={`${s.actionBtn} ${s.actionBtnDanger}`} onClick={onRemove}
              disabled={isMutating} title={removeTitle ?? t('memory.delete')} data-testid="memory-remove">
              <Icon icon={Trash2} size={11} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
