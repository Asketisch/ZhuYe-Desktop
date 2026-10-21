/**
 * Traces 视图控制器 —— session 列表 + 选中 session 的调用详情。
 *
 * 状态面很小(选中 id + 刷新),数据面全部走 TanStack Query:
 * - `sessions`: `reflect_list_traces`(30s stale,与工具列表同级);
 * - `calls`: `reflect_get_trace`,仅在有选中 session 时启用。
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_get_trace,
  reflect_list_traces,
  type TraceCall,
  type TraceSessionSummary,
} from '@/utils/commands/traces';

export interface TracesController {
  /** session 摘要列表(可能为空:尚无 LLM 调用记录)。 */
  sessions: TraceSessionSummary[];
  /** 列表加载态。 */
  loading: boolean;
  /** 列表错误(降级展示,不阻塞页面骨架)。 */
  listError: string | null;
  /** 当前选中的 session id(null = 未选)。 */
  selectedId: string | null;
  /** 选中 session 的逐条调用(未选 / 加载中为空数组)。 */
  calls: TraceCall[];
  /** 详情加载态。 */
  callsLoading: boolean;
  /** 详情错误。 */
  callsError: string | null;
  /** 选中一个 session(重复点击同 id = 保持)。 */
  select: (sessionId: string) => void;
  /** 手动刷新列表。 */
  refresh: () => void;
}

export function useTracesController(): TracesController {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sessionsQ = useQuery({
    queryKey: ['traces', 'sessions'],
    queryFn: () => reflect_list_traces(50),
    staleTime: 30_000,
  });

  const callsQ = useQuery({
    queryKey: ['traces', 'calls', selectedId],
    queryFn: () => reflect_get_trace(selectedId as string),
    enabled: selectedId !== null,
    staleTime: 30_000,
  });

  const errText = (e: unknown): string | null =>
    e instanceof Error ? e.message : e ? String(e) : null;

  return {
    sessions: sessionsQ.data ?? [],
    loading: sessionsQ.isLoading,
    listError: errText(sessionsQ.error),
    selectedId,
    calls: callsQ.data ?? [],
    callsLoading: callsQ.isLoading,
    callsError: errText(callsQ.error),
    select: (id: string) => setSelectedId((cur) => (cur === id ? cur : id)),
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: ['traces'] });
    },
  };
}
