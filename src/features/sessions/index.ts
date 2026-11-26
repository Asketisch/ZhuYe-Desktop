/**
 * sessions 切片公共 API 桶。
 *
 * Sidebar 是主入口（直接由 AppShell 渲染），不再导出 SessionsView（薄包装，已删除）。
 */
export { Sidebar } from './components/Sidebar';
export { SessionItem } from './components/SessionItem';
export { BucketGroup } from './components/BucketGroup';
export { WorkspaceGroup } from './components/WorkspaceGroup';
export {
  useSessions,
  useActiveSession,
  SESSIONS_QUERY_KEY,
  WORKSPACES_QUERY_KEY,
} from '@/logic/sessions/useSessions';
export type { SessionBucket, SessionBucketLabel } from '@/logic/sessions/buckets';
export {
  bucketFor,
  bucketSessions,
  displayTitle,
  SESSION_BUCKET_LABELS,
} from '@/logic/sessions/buckets';
export {
  groupSessionsByWorkspace,
  groupKeyFor,
  basename,
  isPlaceholderWorkspace,
  UNASSIGNED_GROUP_KEY,
} from '@/logic/sessions/workspaceGroups';
export type { WorkspaceSessionGroup } from '@/logic/sessions/workspaceGroups';

export { SessionsDashboard } from './SessionsDashboard';
