import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { TaskCreateFormBinding } from '@/logic/orchestration/tasks-board/TaskCreateFormBinding';
import { TaskCreateForm as DefaultView } from '@/render/orchestration/tasks-board/TaskCreateForm';
import type { TaskCreateFormBindingProps } from '@/contracts/orchestration/taskWidgets';
export type TaskCreateFormProps = Omit<TaskCreateFormBindingProps, 't'>;
export function TaskCreateForm(props: TaskCreateFormProps) { const { t } = useI18n(); const View = useRenderView('TaskCreateForm', DefaultView); return <TaskCreateFormBinding view={View} t={t} {...props} />; }
