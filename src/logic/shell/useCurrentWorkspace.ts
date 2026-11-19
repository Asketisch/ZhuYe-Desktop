/**
 * useCurrentWorkspace —— 当前激活 workspace 路径（绝对路径）。
 *
 * 数据源：`reflect_current_workspace` Tauri 命令。
 * 缓存策略：30s staleTime + 手动 invalidate（`reflect_set_workspace` 成功后）。
 *
 * 消费方：
 * - Composer：`@` 弹层的 `workspaceLabel` + submission.workspace 注入
 *   （新建会话的 workspace 归属即由此携带，`handleNewChat` 本身不注入）。
 * - useSessions（经 AppShell 透传）：session 列表 workspace 过滤键。
 */
import { useQuery } from '@tanstack/react-query';
import { reflect_current_workspace } from '@/utils/commands';

export const CURRENT_WORKSPACE_QUERY_KEY = ['current-workspace'] as const;

const CURRENT_WORKSPACE_STALE_MS = 30_000;

export interface UseCurrentWorkspaceResult {
  /** 当前工作区绝对路径；未加载时为 `null`。 */
  currentWorkspace: string | null;
}

export function useCurrentWorkspace(): UseCurrentWorkspaceResult {
  const { data } = useQuery({
    queryKey: CURRENT_WORKSPACE_QUERY_KEY,
    queryFn: () => reflect_current_workspace(),
    staleTime: CURRENT_WORKSPACE_STALE_MS,
  });
  return { currentWorkspace: data ?? null };
}
