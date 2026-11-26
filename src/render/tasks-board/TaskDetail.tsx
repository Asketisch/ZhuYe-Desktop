/**
 * TaskDetail —— 任务详情抽屉纯展示组件。
 */
import { FileText, X } from 'lucide-react';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { Spinner } from '../design-system/Spinner';
import s from './TasksBoardView.module.css';

import type { TaskDetailViewProps } from '@/contracts/orchestration/taskWidgets';
export function TaskDetail({ task, output, outputLoading, onClose, labels }: TaskDetailViewProps) {
  return (
    <div className={s.detail} data-testid="task-detail">
      <div className={s.detailHeader}>
        <Icon icon={FileText} size={14} />
        <strong>#{task.id} {task.subject}</strong>
        <IconButton label={labels.close} size="sm" onClick={onClose}><Icon icon={X} size={12} /></IconButton>
      </div>
      {task.description && (
        <div className={s.detailSection}>
          <div className={s.detailLabel}>{labels.detailDescription}</div>
          <p className={s.detailText}>{task.description}</p>
        </div>
      )}
      {task.output_path && (
        <div className={s.detailSection}>
          <div className={s.detailLabel}>{labels.detailOutputPath}</div>
          <code className={s.detailPath}>{task.output_path}</code>
        </div>
      )}
      <div className={s.detailSection}>
        <div className={s.detailLabel}>{labels.detailOutput}</div>
        {outputLoading ? <Spinner size={16} /> : output ? <pre className={s.detailOutput} data-testid="task-detail-output">{output}</pre> : <p className={s.detailEmpty} data-testid="task-detail-output-empty">{labels.detailOutputEmpty}</p>}
      </div>
    </div>
  );
}
