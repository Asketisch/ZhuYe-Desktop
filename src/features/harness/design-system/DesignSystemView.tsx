import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { DesignSystemView as DefaultView } from '@/render/harness/design-system-page/DesignSystemView';

export function DesignSystemView() {
  const View = useRenderView('DesignSystemView', DefaultView);
  return <View />;
}
