/**
 * M3.x Session 列表 hook —— TanStack Query 驱动。
 *
 * - useQuery 缓存 `zhuye_list_sessions` 结果(5min staleTime)
 * - useMutation 处理 rename / delete / archive → invalidate → 自动重刷
 * - 时间分桶规则已抽出到 `./buckets.ts`(纯函数,可独立测试)
 * - 项目目录分组规则在 `./workspaceGroups.ts`(侧边栏消费)
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from '@tanstack/react-router';
import {
  zhuye_list_sessions,
  zhuye_list_archived_sessions,
  zhuye_list_workspaces,
  zhuye_rename_session,
  zhuye_fork_session,
  zhuye_generate_session_title,
  zhuye_delete_session,
  zhuye_archive_session,
  zhuye_unarchive_session,
  zhuye_export_session,
  type ZhuyeSessionInfo,
} from '@/utils/commands';
import { bucketSessions, type SessionBucket } from './buckets';
import { groupSessionsByWorkspace, type WorkspaceSessionGroup } from './workspaceGroups';

export type { SessionBucket };

export const SESSIONS_QUERY_KEY = ['sessions'] as const;
/** `['sessions', 'archived']` 是 `['sessions']` 的子键,主列表 invalidate 时一并失效。 */
export const ARCHIVED_SESSIONS_QUERY_KEY = ['sessions', 'archived'] as const;
/** 与 WorkspacesView 共用同一查询键：set_workspace 后的 invalidate 两边都生效。 */
export const WORKSPACES_QUERY_KEY = ['workspaces'] as const;
const SESSIONS_STALE_MS = 5 * 60_000;

export interface UseSessionsResult {
  /** 时间分桶（HomeView / ThreadsView 使用）。 */
  buckets: SessionBucket[];
  /** 项目目录分组（侧边栏使用）；未归属旧会话归入哨兵分组。 */
  groups: WorkspaceSessionGroup[];
  all: ZhuyeSessionInfo[];
  archived: ZhuyeSessionInfo[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refresh: () => void;
  rename: (id: string, newName: string) => Promise<void>;
  /** fork 历史会话为子会话（全量复制），返回子会话 id。 */
  fork: (id: string, branch?: string, upToTurnId?: string) => Promise<string>;
  /** AI 生成/重新生成会话标题（force=true 覆盖旧 AI 标题）。 */
  generateTitle: (id: string, force?: boolean) => Promise<string>;
  remove: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  export: (id: string) => Promise<string | null>;
}

/**
 * @param opts.workspacePath 当前激活工作区绝对路径。
 *   - `null` / 省略 → 全量列表(含未归属旧会话),兼容既有调用;
 *   - 具体路径 → 只列归属该工作区的会话(后端按 `SessionMeta.workspace`
 *     精确过滤;未归属旧会话不出现,避免误归项目视图)。
 */
export function useSessions(
  opts: { workspacePath?: string | null } = {},
): UseSessionsResult {
  const { workspacePath } = opts;
  const qc = useQueryClient();
  const { data: all = [], isLoading, error, refetch } = useQuery({
    // workspace 进 queryKey:切换工作区即重拉;`['sessions']` 前缀失效
    // (rename/delete/archive)对任何 workspace 变体都生效。
    queryKey: ['sessions', { workspace: workspacePath ?? null }],
    queryFn: () => zhuye_list_sessions({ workspace: workspacePath ?? null }),
    staleTime: SESSIONS_STALE_MS,
  });
  const { data: archived = [] } = useQuery({
    queryKey: ARCHIVED_SESSIONS_QUERY_KEY,
    queryFn: () => zhuye_list_archived_sessions(),
    staleTime: SESSIONS_STALE_MS,
  });
  // 已知项目注册表（~/.zhuye/workspaces.json）：空项目组也进侧边栏。
  const { data: knownWorkspaces = [] } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => zhuye_list_workspaces(),
    staleTime: SESSIONS_STALE_MS,
  });

  // 占位会话过滤（双保险）：壳过滤的主防线在后端 `zhuye_list_sessions`
  // （无首条用户消息且非子会话的条目直接不返回）。注意 `message_count`
  // 的真实语义是「非 meta 记录行数」——审计记录（permission/token/selection
  // 等）也占行，因此此处不能只看它：无首条用户消息的壳靠 title 是否为空
  // 兜底（后端已滤掉绝大多数），message_count 仅拦截极旧的 0 行文件。
  // 手动命名过的空会话视为有意保留；首条用户消息落盘后自动回到列表。
  const sessions = useMemo(
    () => all.filter((s) => (s.message_count ?? 0) > 0 || Boolean(s.title)),
    [all],
  );

  const buckets = bucketSessions(sessions);
  const groups = useMemo(
    () => groupSessionsByWorkspace(sessions, knownWorkspaces),
    [sessions, knownWorkspaces],
  );

  const renameMutation = useMutation({
    mutationFn: async ({ id, newName }: { id: string; newName: string }) =>
      zhuye_rename_session(id, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  const generateTitleMutation = useMutation({
    mutationFn: async ({ id, force }: { id: string; force: boolean }) =>
      zhuye_generate_session_title(id, force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  const generateTitle = useCallback(
    (id: string, force = false) => generateTitleMutation.mutateAsync({ id, force }),
    [generateTitleMutation],
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => zhuye_delete_session(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ARCHIVED_SESSIONS_QUERY_KEY });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => zhuye_archive_session(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ARCHIVED_SESSIONS_QUERY_KEY });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => zhuye_unarchive_session(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ARCHIVED_SESSIONS_QUERY_KEY });
    },
  });

  const rename = useCallback(async (id: string, newName: string) => {
    await renameMutation.mutateAsync({ id, newName });
  }, [renameMutation]);

  const forkMutation = useMutation({
    mutationFn: async ({
      id,
      branch,
      upToTurnId,
    }: {
      id: string;
      branch?: string;
      upToTurnId?: string;
    }) => zhuye_fork_session(id, branch, upToTurnId),
    // 子会话继承父的首条消息派生标题 + 自定义名(_names) —— 列表必须重刷。
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  /** fork 历史会话,返回子会话 id（调用方路由切换）。 */
  const fork = useCallback(
    async (id: string, branch?: string, upToTurnId?: string) =>
      forkMutation.mutateAsync({ id, branch, upToTurnId }),
    [forkMutation],
  );

  const remove = useCallback(async (id: string) => {
    await deleteMutation.mutateAsync(id);
  }, [deleteMutation]);

  const archive = useCallback(async (id: string) => {
    await archiveMutation.mutateAsync(id);
  }, [archiveMutation]);

  const unarchive = useCallback(async (id: string) => {
    await unarchiveMutation.mutateAsync(id);
  }, [unarchiveMutation]);

  const exportSession = useCallback(async (id: string) => {
    return zhuye_export_session(id);
  }, []);

  return {
    buckets,
    groups,
    all: sessions,
    archived,
    loading: isLoading,
    error: (error as Error | null)?.message ?? null,
    refetch: () => {
      void refetch();
    },
    refresh: () => {
      void refetch();
    },
    rename,
    fork,
    generateTitle,
    remove,
    archive,
    unarchive,
    export: exportSession,
  };
}

/**
 * 路由驱动的活动 session id —— 与 ChatView / Sidebar 的 URL 同步。
 *
 * 读源: `/chat/$sessionId` 路由参数；fallback 到 `/chat`（无 id,新对话）。
 * 写入: `setActiveId(id)` 导航到 `/chat/$sessionId`,`setActiveId(null)` 导航到 `/chat`。
 *        `clear()` 显式清除(等价 null)。
 */
export interface UseActiveSessionResult {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  clear: () => void;
}

export function useActiveSession(): UseActiveSessionResult {
  const navigate = useNavigate();
  const location = useLocation();

  // 从 pathname 推导 sessionId：匹配 /chat/:sessionId 但不匹配 /chat。
  const activeId = (() => {
    const m = location.pathname.match(/^\/chat\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  })();

  const setActiveId = useCallback((id: string | null) => {
    if (id) {
      void navigate({ to: '/chat/$sessionId', params: { sessionId: id } });
    } else if (location.pathname.startsWith('/chat')) {
      void navigate({ to: '/chat' });
    }
  }, [navigate, location.pathname]);

  const clear = useCallback(() => {
    if (location.pathname.startsWith('/chat')) {
      void navigate({ to: '/chat' });
    }
  }, [navigate, location.pathname]);

  return { activeId, setActiveId, clear };
}
