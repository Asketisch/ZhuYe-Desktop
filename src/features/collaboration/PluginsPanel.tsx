import { useRenderView } from '@/logic/renderer/useRenderView';
import { PluginsPanelBinding } from '@/logic/collaboration/PluginsPanelBinding';
import { PluginsPanel as DefaultView } from '@/render/collaboration/PluginsPanel';
import { MarketplaceRow } from './MarketplaceRow';

export function PluginsPanel() {
  const View = useRenderView('PluginsPanel', DefaultView);
  return <PluginsPanelBinding view={View} MarketplaceRow={MarketplaceRow} />;
}
