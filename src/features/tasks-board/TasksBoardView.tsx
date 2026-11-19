import { useRenderView } from '@/logic/renderer/useRenderView';
import { TasksBoardBinding } from '@/logic/tasks-board/TasksBoardBinding';
import { TasksBoardView as DefaultView } from '@/render/tasks-board/TasksBoardView';

export function TasksBoardView() {
  const View = useRenderView('TasksBoardView', DefaultView);
  return <TasksBoardBinding view={View} />;
}
