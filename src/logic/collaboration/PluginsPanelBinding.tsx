import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { usePluginsPanelController } from './usePluginsPanelController';
import type { PluginsPanelProps } from '@/contracts/pluginsPanel';
export function PluginsPanelBinding({ view: View, MarketplaceRow }: { view: ComponentType<PluginsPanelProps>; MarketplaceRow: PluginsPanelProps['MarketplaceRow'] }) {
  const { t } = useI18n(); return <View t={t} ctrl={usePluginsPanelController()} MarketplaceRow={MarketplaceRow} />;
}
