import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { PluginsPanelBinding } from '@/logic/orchestration/collaboration/PluginsPanelBinding';
import { PluginsPanel as DefaultView } from '@/render/orchestration/collaboration/PluginsPanel';
import { MarketplaceRow } from './MarketplaceRow';

export function PluginsPanel() {
  const View = useRenderView('PluginsPanel', DefaultView);
  return <PluginsPanelBinding view={View} MarketplaceRow={MarketplaceRow} />;
}
