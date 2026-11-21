import type { I18nContextValue } from '@/utils/i18n/context';
import type { ModelUsage, RateCard, SessionStats } from '@/utils/commands/stats';
export type { ModelUsage } from '@/utils/commands/stats';
import type { LiveModelUsage } from '@/stores/agent/types';

export interface UsageViewProps {
  t: I18nContextValue['t'];
  title: string;
  subtitle: string;
  width: 'sm' | 'md' | 'lg';
  iconName: 'gauge';
  sessionId: string | null;
  stats: SessionStats | null;
  statsError: string | null;
  models: ModelUsage[];
  modelsLoading: boolean;
  modelsError: string | null;
  live: LiveModelUsage[];
  rateCards: RateCard[];
  /** 近 91 天每日活跃会话数（活动热力数据源）。 */
  dailyActivity: Array<{ date: string; count: number }>;
  onRefresh: () => void;
  labels: {
    refresh: string; currentSession: string; noSession: string; noSessionHint: string;
    noStats: string; emptyHint: string; perModel: string; live: string; liveHint: string;
    liveEmpty: string; liveEmptyHint: string; rates: string; ratesHint: string;
    model: string; provider: string; calls: string; input: string; output: string;
    total: string; cost: string; cached: string; rateInput: string; rateOutput: string;
    rateCacheRead: string; rateCacheWrite: string; notPriced: string; messages: string;
    toolCalls: string; cacheHitRate: string; tokensSaved: string; memoryAccess: string;
    empty: string; heatmap: string; heatmapHint: string;
  };
}
