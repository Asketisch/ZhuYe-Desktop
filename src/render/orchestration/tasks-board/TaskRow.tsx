/**
 * TaskRow —— 任务行纯展示组件。
 */
import { CheckCircle, Play, Trash2, Hand, Square, FileText, Unlock } from 'lucide-react';
import type { TaskStatus } from '@/contracts/orchestration/tasksBoard';
import { Badge } from '@/render/harness/design-system/Badge';
import { Icon } from '@/render/harness/design-system/Icon';
import s from './TasksBoardView.module.css';

const STATUS_VARIANT: Record<TaskStatus, 'neutral' | 'accent' | 'success' | 'danger'> = {
  pending: 'neutral',
  in_progress: 'accent',
  completed: 'success',
  deleted: 'danger',
};

import type { TaskRowViewProps } from '@/contracts/orchestration/taskWidgets';
export function TaskRow({ task, labels, statusLabels, onClaim, onAdvance, onRemove, onSelect, onStop, onRelease }: TaskRowViewProps) {
  return (
    <div className={s.row} data-testid={`task-row-${task.id}`}>
      <div className={s.rowMain}>
        <span className={s.rowId}>#{task.id}</span>
        <span className={s.rowSubject}>{task.subject}</span>
        {task.claimed_by && (
          <span className={s.rowClaimer} title={labels.claimedBy}>
            <Icon icon={Hand} size={11} /> {task.claimed_by}
          </span>
        )}
      </div>
      <div className={s.rowSide}>
        <Badge variant={STATUS_VARIANT[task.status]}>{statusLabels[task.status]}</Badge>
        <div className={s.rowActions}>
          <button type="button" className={s.actionBtn} onClick={() => onSelect(task)} title={labels.details} data-testid={`task-details-${task.id}`}>
            <Icon icon={FileText} size={12} />
          </button>
          {task.status === 'pending' && (
            <>
              <button type="button" className={s.actionBtn} onClick={() => onClaim(task)} title={labels.claim} data-testid={`task-claim-${task.id}`}>
                <Icon icon={Hand} size={12} /> {labels.claim}
              </button>
              <button type="button" className={s.actionBtn} onClick={() => onAdvance(task, 'in_progress')} title={labels.start}>
                <Icon icon={Play} size={12} /> {labels.start}
              </button>
            </>
          )}
          {task.status === 'in_progress' && (
            <>
              <button type="button" className={s.actionBtn} onClick={() => onAdvance(task, 'completed')} title={labels.complete} data-testid={`task-complete-${task.id}`}>
                <Icon icon={CheckCircle} size={12} /> {labels.complete}
              </button>
              <button type="button" className={s.actionBtn} onClick={() => onStop(task)} title={labels.stop} data-testid={`task-stop-${task.id}`}>
                <Icon icon={Square} size={12} /> {labels.stop}
              </button>
            </>
          )}
          {task.claimed_by && task.status !== 'completed' && task.status !== 'deleted' && (
            <button type="button" className={s.actionBtn} onClick={() => onRelease(task)} title={labels.release} data-testid={`task-release-${task.id}`}>
              <Icon icon={Unlock} size={12} /> {labels.release}
            </button>
          )}
          {task.status !== 'deleted' && (
            <button type="button" className={`${s.actionBtn} ${s.actionBtnDanger}`} onClick={() => onRemove(task)} title={labels.delete} data-testid={`task-delete-${task.id}`}>
              <Icon icon={Trash2} size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
