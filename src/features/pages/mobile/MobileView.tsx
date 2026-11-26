import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { MobileView as DefaultView } from '@/render/pages/mobile/MobileView';

export function MobileView() {
  const View = useRenderView('MobileView', DefaultView);
  return <View />;
}
