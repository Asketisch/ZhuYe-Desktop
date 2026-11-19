import { useRenderView } from '@/logic/renderer/useRenderView';
import { DesignSystemView as DefaultView } from '@/render/design-system-page/DesignSystemView';

export function DesignSystemView() {
  const View = useRenderView('DesignSystemView', DefaultView);
  return <View />;
}
