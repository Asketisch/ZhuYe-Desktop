/**
 * Memory —— AddForm（纯展示组件）。
 */
import { Save } from 'lucide-react';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import type { MemoryViewProps } from '@/contracts/memory';
import s from './MemoryView.module.css';

export interface MemoryAddFormProps {
  t: MemoryViewProps['t'];
  newScope: 'user' | 'project';
  newKey: string;
  newValue: string;
  setNewScope: (scope: 'user' | 'project') => void;
  setNewKey: (value: string) => void;
  setNewValue: (value: string) => void;
  onSubmit: () => void;
  isMutating: boolean;
}

export function MemoryAddForm({ t, newScope, newKey, newValue, setNewScope, setNewKey, setNewValue,
  onSubmit, isMutating }: MemoryAddFormProps) {
  return (
    <Card level="outlined" padding="sm" className={s.addForm}>
      <div className={s.formRow}>
        <select value={newScope} onChange={(event) => setNewScope(event.target.value as 'user' | 'project')}
          className={s.formSelect} data-testid="memory-new-scope">
          <option value="user">{t('memory.scope.userCap')}</option>
          <option value="project">{t('memory.scope.projectCap')}</option>
        </select>
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} className={s.formInput}
          placeholder={t('memory.key')} data-testid="memory-new-key" />
        <input value={newValue} onChange={(event) => setNewValue(event.target.value)} className={s.formInput}
          placeholder={t('memory.value')} data-testid="memory-new-value" />
        <button type="button" className={s.saveBtn} onClick={onSubmit} disabled={isMutating} data-testid="memory-add-confirm">
          <Icon icon={Save} size={12} /> {t('memory.save')}
        </button>
      </div>
    </Card>
  );
}
