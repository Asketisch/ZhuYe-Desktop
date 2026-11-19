import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/renderer/useRenderView';
import { TaskDetailBinding } from '@/logic/tasks-board/TaskDetailBinding';
import { TaskDetail as DefaultView } from '@/render/tasks-board/TaskDetail';
export interface TaskDetailProps { task: import('@/utils/commands').ReflectTask; onClose: () => void }
export function TaskDetail({ task, onClose }: TaskDetailProps) { const { t } = useI18n(); const View = useRenderView('TaskDetail', DefaultView); return <TaskDetailBinding view={View} task={task} onClose={onClose} t={t} />; }
