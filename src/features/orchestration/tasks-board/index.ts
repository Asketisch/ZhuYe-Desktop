/**
 * tasks-board 功能桶（Phase 1 多 agent UI）。
 */
export { TasksBoardView } from './TasksBoardView';
export { useTasksBoardController } from '@/logic/orchestration/tasks-board/useTasksBoardController';
export type {
  TasksBoardController,
  BoardView,
} from '@/logic/orchestration/tasks-board/useTasksBoardController';
export { DEFAULT_LIST_ID, STATUS_LABELS, STATUS_ORDER } from '@/logic/orchestration/tasks-board/useTasksBoardController';
