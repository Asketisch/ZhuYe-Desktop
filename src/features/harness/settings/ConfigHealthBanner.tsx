import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ConfigHealthBinding } from '@/logic/settings/ConfigHealthBinding';
import { ConfigHealthBanner as DefaultView } from '@/render/harness/settings/ConfigHealthBanner';

export function ConfigHealthBanner() {
  const renderer = useRenderer();
  return <ConfigHealthBinding view={renderer?.ConfigHealthBanner ?? DefaultView} />;
}
