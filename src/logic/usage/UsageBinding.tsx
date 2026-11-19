/**
 * Usage 绑定——控制器数据转发给可替换视图。
 */
import type { ComponentType } from 'react';
import type { UsageViewProps } from '@/contracts/usage';
import { useI18n } from '@/utils/i18n';
import { useUsageController } from './useUsageController';

export function UsageBinding({ view: View }: { view: ComponentType<UsageViewProps> }) {
  const c = useUsageController();
  const { t } = useI18n();
  return (
    <View
      t={t} title={t('usage.title')} subtitle={t('usage.subtitle')} width="lg" iconName="gauge"
      sessionId={c.sessionId} stats={c.stats} statsError={c.statsError}
      models={c.models} modelsLoading={c.modelsLoading} modelsError={c.modelsError}
      live={c.live} rateCards={c.rateCards} onRefresh={c.refresh}
      labels={{
        refresh: t('usage.refresh'), currentSession: t('usage.currentSession'),
        noSession: t('usage.noSession'), noSessionHint: t('usage.noSessionHint'),
        noStats: t('usage.noStats'), emptyHint: t('usage.emptyHint'),
        perModel: t('usage.perModel'), live: t('usage.live'), liveHint: t('usage.liveHint'),
        liveEmpty: t('usage.liveEmpty'), liveEmptyHint: t('usage.liveEmptyHint'),
        rates: t('usage.rates'), ratesHint: t('usage.ratesHint'),
        model: t('usage.model'), provider: t('usage.provider'), calls: t('usage.calls'),
        input: t('usage.input'), output: t('usage.output'), total: t('usage.total'),
        cost: t('usage.cost'), cached: t('usage.cached'), rateInput: t('usage.rateInput'),
        rateOutput: t('usage.rateOutput'), rateCacheRead: t('usage.rateCacheRead'),
        rateCacheWrite: t('usage.rateCacheWrite'), notPriced: t('usage.notPriced'),
        messages: t('usage.messages'), toolCalls: t('usage.toolCalls'),
        cacheHitRate: t('usage.cacheHitRate'), tokensSaved: t('usage.tokensSaved'),
        memoryAccess: t('usage.memoryAccess'), empty: t('usage.empty'),
      }}
    />
  );
}
