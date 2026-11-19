import { useRenderView } from '@/logic/renderer/useRenderView';
import { MobileView as DefaultView } from '@/render/mobile/MobileView';

export function MobileView() {
  const View = useRenderView('MobileView', DefaultView);
  return <View />;
}
