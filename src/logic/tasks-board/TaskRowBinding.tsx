import type { ComponentType } from 'react';
import type { TaskRowBindingProps, TaskRowViewProps } from '@/contracts/taskWidgets';
export function TaskRowBinding({ view: View, t, ...props }: TaskRowBindingProps & { view: ComponentType<TaskRowViewProps> }) {
  const labels = { claim: t('tasks.claim'), start: t('tasks.start'), complete: t('tasks.complete'), stop: t('tasks.stop'), release: t('tasks.release'), delete: t('tasks.delete'), details: t('tasks.details'), claimedBy: t('tasks.claimed_by') };
  const statusLabels = { pending: t('tasks.status.pending'), in_progress: t('tasks.status.inProgress'), completed: t('tasks.status.completed'), deleted: t('tasks.status.deleted') };
  return <View {...props} labels={labels} statusLabels={statusLabels} />;
}
