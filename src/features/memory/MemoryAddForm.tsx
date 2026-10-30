/**
 * Memory —— AddForm（纯展示组件，B11-01 重构）。
 *
 * 创建新记忆条目的无状态表单。行为与之前在 MemoryView 内渲染的内联表单保持一致。
 */
import { Save } from 'lucide-react';
import { Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { NEW_SCOPES } from './useMemoryController';
import s from './MemoryView.module.css';

export interface MemoryAddFormProps {
  newScope: 'user' | 'project';
  newKey: string;
  newValue: string;
  setNewScope: (s: 'user' | 'project') => void;
  setNewKey: (v: string) => void;
  setNewValue: (v: string) => void;
  onSubmit: () => void;
  isMutating: boolean;
}

export function MemoryAddForm({
  newScope,
  newKey,
  newValue,
  setNewScope,
  setNewKey,
  setNewValue,
  onSubmit,
  isMutating,
}: MemoryAddFormProps) {
  const { t } = useI18n();

  return (
    <Card level="outlined" padding="sm" className={s.addForm}>
      <div className={s.formRow}>
        <select
          value={newScope}
          onChange={(e) => setNewScope(e.target.value as 'user' | 'project')}
          className={s.formSelect}
          data-testid="memory-new-scope"
        >
          {NEW_SCOPES.map((sc) => (
            <option key={sc} value={sc}>
              {t(sc === 'user' ? 'memory.scope.userCap' : 'memory.scope.projectCap')}
            </option>
          ))}
        </select>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className={s.formInput}
          placeholder={t('memory.key')}
          data-testid="memory-new-key"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className={s.formInput}
          placeholder={t('memory.value')}
          data-testid="memory-new-value"
        />
        <button type="button" className={s.saveBtn} onClick={onSubmit} disabled={isMutating} data-testid="memory-add-confirm">
          <Icon icon={Save} size={12} /> {t('memory.save')}
        </button>
      </div>
    </Card>
  );
}
