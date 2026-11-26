import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { MediaBinding } from '@/logic/telemetry/media/MediaBinding';
import { MediaView as DefaultView } from '@/render/telemetry/media/MediaView';
import { StudioTab, ComputerUseTab } from './MediaTabs';

export function MediaView() {
  const View = useRenderView('MediaView', DefaultView);
  return <MediaBinding view={View} StudioTab={StudioTab} ComputerUseTab={ComputerUseTab} />;
}
