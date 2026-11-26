import type { ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useI18n } from '@/utils/i18n';
import { useMarketController } from './useMarketController';
import type { MarketViewProps } from '@/contracts/knowledge/market';

/** 将市场状态与动作交给调用方提供的展示组件。 */
export function MarketBinding({ view: View }: { view: ComponentType<MarketViewProps> }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ctrl = useMarketController();

  return (
    <View
      t={t}
      query={ctrl.query}
      filter={ctrl.filter}
      cards={ctrl.cards}
      installedCount={ctrl.installedCount}
      availableCount={ctrl.availableCount}
      loading={ctrl.loading}
      busyId={ctrl.busyId}
      onQueryChange={ctrl.setQuery}
      onFilterChange={ctrl.setFilter}
      onBack={() => void navigate({ to: '/' })}
      onAction={(card) => {
        if (card.action) void ctrl.runAction(card, card.action);
      }}
      onSecondary={(card) => {
        if (card.secondary) void ctrl.runAction(card, card.secondary);
      }}
    />
  );
}
