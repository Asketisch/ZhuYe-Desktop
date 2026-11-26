import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/renderer/useRenderView';
import { TaskRowBinding } from '@/logic/tasks-board/TaskRowBinding';
import { TaskRow as DefaultView } from '@/render/tasks-board/TaskRow';
import type { TaskRowBindingProps } from '@/contracts/orchestration/taskWidgets';
export type TaskRowProps = Omit<TaskRowBindingProps, 't'>;
export function TaskRow(props: TaskRowProps) { const { t } = useI18n(); const View = useRenderView('TaskRow', DefaultView); return <TaskRowBinding view={View} t={t} {...props} />; }
