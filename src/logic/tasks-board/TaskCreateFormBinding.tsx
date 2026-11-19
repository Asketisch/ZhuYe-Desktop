import type { ComponentType } from 'react';
import type { TaskCreateFormBindingProps, TaskCreateFormViewProps } from '@/contracts/taskWidgets';
export function TaskCreateFormBinding({ view: View, t, ...props }: TaskCreateFormBindingProps & { view: ComponentType<TaskCreateFormViewProps> }) {
  return <View {...props} labels={{ subject: t('tasks.subject'), description: t('tasks.description'), owner: t('tasks.owner'), create: t('tasks.create') }} />;
}
