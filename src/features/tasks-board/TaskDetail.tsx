/**
 * TaskDetail —— 任务详情抽屉:描述 + 产出(worker 的交付物)。
 *
 * 「产出」读的是核心 `TaskOutputTool` 同款来源:任务 `output_path` 指向的
 * 文件。**不阻塞** —— worker 还没写完时是空串,不把界面挂住。
 *
 * 此前任务板只能看到 subject / 状态 / 认领人 —— 看不到 worker 到底
 * 产出了什么,任务板对多 agent 协作基本无用。
 */
import { useQuery } from '@tanstack/react-query';
import { FileText, X } from 'lucide-react';
import { Icon, IconButton, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_get_task_output, type ReflectTask } from '@/utils/commands';
import s from './TasksBoardView.module.css';

export interface TaskDetailProps {
  task: ReflectTask;
  onClose: () => void;
}

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  const { t } = useI18n();
  const outputQ = useQuery({
    queryKey: ['task-output', task.list_id, task.id],
    queryFn: () => reflect_get_task_output(task.list_id, task.id),
    staleTime: 5_000,
  });
  const output = outputQ.data ?? '';

  return (
    <div className={s.detail} data-testid="task-detail">
      <div className={s.detailHeader}>
        <Icon icon={FileText} size={14} />
        <strong>
          #{task.id} {task.subject}
        </strong>
        <IconButton label={t('common.close')} size="sm" onClick={onClose}>
          <Icon icon={X} size={12} />
        </IconButton>
      </div>

      {task.description && (
        <div className={s.detailSection}>
          <div className={s.detailLabel}>{t('tasks.detail.description')}</div>
          <p className={s.detailText}>{task.description}</p>
        </div>
      )}

      {task.output_path && (
        <div className={s.detailSection}>
          <div className={s.detailLabel}>{t('tasks.detail.outputPath')}</div>
          <code className={s.detailPath}>{task.output_path}</code>
        </div>
      )}

      <div className={s.detailSection}>
        <div className={s.detailLabel}>{t('tasks.detail.output')}</div>
        {outputQ.isLoading ? (
          <Spinner size={16} />
        ) : output ? (
          <pre className={s.detailOutput} data-testid="task-detail-output">
            {output}
          </pre>
        ) : (
          <p className={s.detailEmpty} data-testid="task-detail-output-empty">
            {t('tasks.detail.outputEmpty')}
          </p>
        )}
      </div>
    </div>
  );
}
