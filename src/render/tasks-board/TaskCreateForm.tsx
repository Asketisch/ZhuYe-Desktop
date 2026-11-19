/**
 * TaskCreateForm —— 创建任务表单纯展示组件。
 */
import { Plus } from 'lucide-react';
import { Icon } from '../design-system/Icon';
import s from './TasksBoardView.module.css';

import type { TaskCreateFormViewProps } from '@/contracts/taskWidgets';
export function TaskCreateForm({ newSubject, newDescription, newOwner, setNewSubject, setNewDescription, setNewOwner, onSubmit, labels }: TaskCreateFormViewProps) {
  return (
    <form className={s.addForm} data-testid="task-create-form" onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}>
      <input className={s.formInput} placeholder={labels.subject} value={newSubject} onChange={(e) => setNewSubject(e.target.value)} data-testid="task-create-subject" autoFocus />
      <input className={s.formInput} placeholder={labels.description} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} data-testid="task-create-description" />
      <input className={s.formInput} placeholder={labels.owner} value={newOwner} onChange={(e) => setNewOwner(e.target.value)} data-testid="task-create-owner" />
      <button type="submit" className={s.saveBtn} data-testid="task-create-submit"><Icon icon={Plus} size={12} /> {labels.create}</button>
    </form>
  );
}
