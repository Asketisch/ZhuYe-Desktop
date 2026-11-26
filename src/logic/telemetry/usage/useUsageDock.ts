/**
 * UsageDock 控制器 —— 右 dock「用量」面板的数据面。
 *
 * 数据源与选型（跨会话成本对比唯一方案,已定）：
 * - 会话统计：`zhuye_session_stats(activeId)` —— rollout JSONL 聚合,
 *   仅在路由上有活动会话时启用;
 * - **跨会话成本对比走 `zhuye_list_sessions`**（经 `useSessions` 缓存,
 *   与侧栏同源）：每条会话自带 `cost_usd` 累计,一次轻量查询即可拿到
 *   全部会话的费用,无需逐会话 `zhuye_session_stats`（那是每会话一次
 *   全量 JSONL 扫描,成本不必要）;
 * - 模型费率：`zhuye_model_rate_cards`,对「本会话统计涉及的模型集」
 *   反解单价,让费用构成可解释。
 *
 * 刷新策略：活动会话变化由 queryKey 变化自动重拉;手动刷新按钮
 * invalidate 本面板全部查询 + 会话列表。
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveSession, useSessions, SESSIONS_QUERY_KEY } from '@/logic/conversation/sessions/useSessions';
import {
  zhuye_model_rate_cards,
  zhuye_session_stats,
  type RateCard,
  type SessionStats,
} from '@/utils/commands/telemetry/stats';
import type { ZhuyeSessionInfo } from '@/utils/types';

/** 跨会话成本对比最多展示的会话条数。 */
export const USAGE_DOCK_COST_TOP_N = 8;

/** 单会话成本行（跨会话对比,按费用降序 top N）。 */
export interface UsageDockCostRow {
  sessionId: string;
  title: string | null;
  costUsd: number;
  /** 当前活动会话（`.top` 高亮）。 */
  current: boolean;
}

/**
 * 构建跨会话成本行：cost_usd 为有效正数的会话,按费用降序取 top N。
 * 当前会话若不在 top N 内则不出现（规格即 top 8 by cost）。
 */
export function buildCostRows(
  sessions: ZhuyeSessionInfo[],
  activeId: string | null,
): UsageDockCostRow[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((s) => s && typeof s.cost_usd === 'number' && Number.isFinite(s.cost_usd) && s.cost_usd > 0)
    .map((s) => ({
      sessionId: s.session_id,
      title: typeof s.title === 'string' && s.title.length > 0 ? s.title : null,
      costUsd: s.cost_usd as number,
      current: s.session_id === activeId,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, USAGE_DOCK_COST_TOP_N);
}

/** USD 金额文本：≥1¢ 两位小数,更小的给 4 位精度避免显示成 $0.00。 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
}

/** token 构成分段（本会话总量卡的堆叠条 + 图例）。 */
export interface UsageDockSegment {
  key: 'cached' | 'fresh' | 'output';
  value: number;
  /** 占 (cached+fresh+output) 的比例 0-1;总零时为 0。 */
  share: number;
}

/**
 * token 三分段（适配 SessionStats 实有字段）：cachedTokens 为缓存命中;
 * 「新输入」= inputTokens − cachedTokens（cache_creation 归入新输入,
 * 三段口径与设计稿对齐）;输出 = outputTokens。
 */
export function buildSegments(stats: SessionStats | null): UsageDockSegment[] {
  if (!stats) return [];
  const cached = Math.max(0, num(stats.cachedTokens));
  const input = Math.max(0, num(stats.inputTokens));
  const fresh = Math.max(0, input - cached);
  const output = Math.max(0, num(stats.outputTokens));
  const total = cached + fresh + output;
  if (total <= 0) return [];
  const share = (v: number) => (total > 0 ? v / total : 0);
  const all: UsageDockSegment[] = [
    { key: 'cached', value: cached, share: share(cached) },
    { key: 'fresh', value: fresh, share: share(fresh) },
    { key: 'output', value: output, share: share(output) },
  ];
  return all.filter((seg) => seg.value > 0);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface UsageDockData {
  /** 活动会话 id（null = 未绑定）。 */
  activeId: string | null;
  /** 会话标题（列表缺省时为 null）。 */
  sessionTitle: string | null;
  /** 本会话统计（未绑定 / 磁盘无记录时为 null）。 */
  stats: SessionStats | null;
  /** 跨会话成本行（top N,按费用降序）。 */
  costRows: UsageDockCostRow[];
  /** 模型费率卡（仅本会话涉及的模型）。 */
  rateCards: RateCard[];
  /** 手动刷新。 */
  refresh: () => void;
}

export function useUsageDock(): UsageDockData {
  const activeId = useActiveSession().activeId;
  const queryClient = useQueryClient();
  const { all: sessions } = useSessions();

  const statsQ = useQuery({
    queryKey: ['usageDock', 'stats', activeId],
    queryFn: () => zhuye_session_stats(activeId as string),
    enabled: !!activeId,
    staleTime: 15_000,
  });

  // 会话标题：列表里找当前会话（列表已由侧栏缓存,零额外开销）。
  const sessionTitle = useMemo(() => {
    const found = sessions.find((s) => s.session_id === activeId);
    return found?.title ?? null;
  }, [sessions, activeId]);

  // 费率卡模型集 = 本会话统计涉及的模型 ∪ 会话默认模型。
  const modelNames = useMemo(() => {
    const set = new Set<string>();
    const stats = statsQ.data;
    if (stats && Array.isArray(stats.perModel)) {
      for (const m of stats.perModel) {
        if (m && typeof m.model === 'string' && m.model) set.add(m.model);
      }
    }
    if (stats && typeof stats.model === 'string' && stats.model) set.add(stats.model);
    return [...set];
  }, [statsQ.data]);

  const ratesQ = useQuery({
    queryKey: ['usageDock', 'rates', modelNames],
    queryFn: () => zhuye_model_rate_cards(modelNames),
    enabled: modelNames.length > 0,
    staleTime: 300_000,
  });

  const costRows = useMemo(() => buildCostRows(sessions, activeId), [sessions, activeId]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['usageDock'] });
    // 会话级 cost_usd 来自列表查询,一并失效让对比区跟着刷新。
    void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
  }, [queryClient]);

  return {
    activeId,
    sessionTitle,
    stats: statsQ.data ?? null,
    costRows,
    rateCards: Array.isArray(ratesQ.data) ? ratesQ.data : [],
    refresh,
  };
}
