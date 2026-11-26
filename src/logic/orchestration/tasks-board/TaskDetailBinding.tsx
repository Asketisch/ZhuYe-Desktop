import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zhuye_get_task_output } from '@/utils/commands';
import type { TaskDetailBindingProps, TaskDetailViewProps } from '@/contracts/orchestration/taskWidgets';
export function TaskDetailBinding({ view: View, task, onClose, t }: TaskDetailBindingProps & { view: ComponentType<TaskDetailViewProps> }) {
  const query = useQuery({ queryKey: ['task-output', task.list_id, task.id], queryFn: () => zhuye_get_task_output(task.list_id, task.id), staleTime: 5_000 });
  return <View task={task} output={query.data ?? ''} outputLoading={query.isLoading} onClose={onClose}
    labels={{ close: t('common.close'), detailDescription: t('tasks.detail.description'), detailOutputPath: t('tasks.detail.outputPath'), detailOutput: t('tasks.detail.output'), detailOutputEmpty: t('tasks.detail.outputEmpty') }} />;
}
