/**
 * Usage 视图控制器 —— 当前会话统计 + 全局模型级用量 + 费率卡。
 *
 * 数据面走 TanStack Query,读的是 rollout JSONL 落盘后的聚合
 * (与 CLI `reflect session stats` 同源):
 * - `stats`  : `reflect_session_stats`,仅在已绑定会话时启用;
 * - `models` : `reflect_all_model_usage`,全部会话合计的按模型拆分;
 * - `rateCards`: `reflect_model_rate_cards`,核心静态费率表反解 ——
 *   让「费用」在 UI 上可解释(单价 × 分段 = 金额)。
 *
 * 另有一路 **live** 投影直接来自 store(`tokens.byModel`):本次会话
 * 进行中的按模型累计(含引擎随事件算好的 cost)。与落盘统计的口径区别
 * 在 UI 上明确标注。
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import type { LiveModelUsage } from '@/stores/agent/types';
import {
  reflect_all_model_usage,
  reflect_model_rate_cards,
  reflect_session_stats,
  type ModelUsage,
  type RateCard,
  type SessionStats,
} from '@/utils/commands/stats';

export interface UsageController {
  /** 当前绑定的会话 id(null = 尚未绑定任何会话)。 */
  sessionId: string | null;
  /** 当前会话统计(未绑定会话 / 该会话尚无记录时为 null)。 */
  stats: SessionStats | null;
  /** 会话统计加载态。 */
  statsLoading: boolean;
  /** 会话统计错误。 */
  statsError: string | null;
  /** 全部会话合计的模型级用量。 */
  models: ModelUsage[];
  /** 全局用量加载态。 */
  modelsLoading: boolean;
  /** 全局用量错误。 */
  modelsError: string | null;
  /** 本次会话**进行中**的按模型累计(store live 投影)。 */
  live: LiveModelUsage[];
  /** 费率卡(核心静态费率表反解)。 */
  rateCards: RateCard[];
  /** 手动刷新。 */
  refresh: () => void;
}

export function useUsageController(): UsageController {
  const queryClient = useQueryClient();
  const sessionId = useAgentStore((st) => st.loadedSessionId ?? null);
  const byModel = useAgentStore((st) => st.tokens?.byModel);

  const statsQ = useQuery({
    queryKey: ['usage', 'session', sessionId],
    queryFn: () => reflect_session_stats(sessionId as string),
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  const modelsQ = useQuery({
    queryKey: ['usage', 'models'],
    queryFn: () => reflect_all_model_usage(),
    staleTime: 30_000,
  });

  // live 按模型累计(按 token 降序)。
  const live = useMemo(() => {
    const entries = Object.values(byModel ?? {});
    return [...entries].sort((a, b) => b.total - a.total);
  }, [byModel]);

  // 需要费率卡的模型集合 = 落盘统计 ∪ 全局统计 ∪ live 累计。
  const modelNames = useMemo(() => {
    const set = new Set<string>();
    for (const m of statsQ.data?.perModel ?? []) set.add(m.model);
    for (const m of modelsQ.data ?? []) set.add(m.model);
    for (const m of live) set.add(m.model);
    return [...set];
  }, [statsQ.data, modelsQ.data, live]);

  const rateQ = useQuery({
    queryKey: ['usage', 'rate-cards', modelNames],
    queryFn: () => reflect_model_rate_cards(modelNames),
    enabled: modelNames.length > 0,
    staleTime: 300_000,
  });

  const errText = (e: unknown): string | null =>
    e instanceof Error ? e.message : e ? String(e) : null;

  return {
    sessionId,
    stats: statsQ.data ?? null,
    statsLoading: statsQ.isLoading,
    statsError: errText(statsQ.error),
    models: modelsQ.data ?? [],
    modelsLoading: modelsQ.isLoading,
    modelsError: errText(modelsQ.error),
    live,
    rateCards: rateQ.data ?? [],
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  };
}
