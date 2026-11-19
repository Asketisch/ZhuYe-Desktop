/**
 * useActivityController —— Activity timeline + @mention 搜索的
 * TanStack Query 控制器 (Phase 3 条目 9).
 *
 * 数据源:
 * - `reflect_list_activity` —— 全量 + 过滤(activity tab)。
 * - `reflect_search_activity` —— `@<query>` mention 搜索(mentions tab)。
 * - `reflect_clear_activity` —— 清空内存缓冲(诊断用)。
 *
 * 设计:`tab` 选择由父组件(NotificationsView)拥有,本 hook 只持 activity /
 * mentions 两套 query 的数据 + 过滤状态。query 的 `enabled` 由参数
 * `activeTab` 驱动 —— 父组件渲染 ActivityTab 时传 `'activity'`、渲染
 * MentionsTab 时传 `'mentions'`,避免每处子组件各起一份 controller 造成
 * 状态分裂 + query 永不启用。
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  reflect_list_activity,
  reflect_search_activity,
  reflect_clear_activity,
  type ReflectActivityEvent,
  type ReflectActivityFilter,
  type ReflectActivityLevel,
  extractMentions,
} from '@/utils/commands/activity';

export const ACTIVITY_QUERY_KEY = ['activity'] as const;
export const ACTIVITY_MENTIONS_QUERY_KEY = ['activity', 'mentions'] as const;
export const ACTIVITY_STALE_MS = 5_000;

/** 顶部标签类型。 */
export type ActivityTab = 'inbox' | 'activity' | 'mentions';

export interface ActivityController {
  /** activity tab 的过滤(level:info/warn/error)。 */
  level: ReflectActivityLevel | 'all';
  setLevel: (l: ActivityController['level']) => void;
  /** mentions tab 的 @query 字符串。 */
  mentionQuery: string;
  setMentionQuery: (q: string) => void;
  /** activity tab 的事件数组(已是活动方向的最新优先)。 */
  activityEvents: ReflectActivityEvent[];
  /** mentions tab 的事件数组。 */
  mentionEvents: ReflectActivityEvent[];
  /** activity tab 的 loading / error。 */
  activityLoading: boolean;
  activityError: Error | null;
  /** mentions tab 的 loading / error。 */
  mentionLoading: boolean;
  mentionError: Error | null;
  refetchActivity: () => void;
  clear: () => Promise<void>;
  /** 从纯文本提取 mention ID。 */
  extractMentions: (text: string) => string[];
}

/**
 * @param activeTab 父组件当前激活的 tab,驱动两个 query 的 `enabled`。
 *   只有在对应 tab 上才发起网络请求。
 */
export function useActivityController(activeTab: ActivityTab): ActivityController {
  const qc = useQueryClient();
  const [level, setLevel] = useState<ActivityController['level']>('all');
  const [mentionQuery, setMentionQuery] = useState('');

  const activityFilter: ReflectActivityFilter = useMemo(() => {
    if (level === 'all') return { limit: 200 };
    return { level, limit: 200 };
  }, [level]);

  const activityQ = useQuery({
    queryKey: [...ACTIVITY_QUERY_KEY, 'list', activityFilter] as const,
    queryFn: () => reflect_list_activity(activityFilter),
    enabled: activeTab === 'activity',
    staleTime: ACTIVITY_STALE_MS,
  });

  const mentionsQ = useQuery({
    queryKey: [...ACTIVITY_MENTIONS_QUERY_KEY, mentionQuery] as const,
    queryFn: () => reflect_search_activity(mentionQuery),
    enabled: activeTab === 'mentions',
    staleTime: ACTIVITY_STALE_MS,
  });

  const clearMut = useMutation({
    mutationFn: () => reflect_clear_activity(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ACTIVITY_QUERY_KEY] });
    },
  });

  const refetchActivity = useCallback(() => {
    void activityQ.refetch();
  }, [activityQ]);

  return {
    level,
    setLevel,
    mentionQuery,
    setMentionQuery,
    activityEvents: activityQ.data ?? [],
    mentionEvents: mentionsQ.data ?? [],
    activityLoading: activityQ.isLoading,
    activityError: (activityQ.error as Error | null) ?? null,
    mentionLoading: mentionsQ.isLoading,
    mentionError: (mentionsQ.error as Error | null) ?? null,
    refetchActivity,
    clear: async () => {
      await clearMut.mutateAsync();
    },
    extractMentions,
  };
}
