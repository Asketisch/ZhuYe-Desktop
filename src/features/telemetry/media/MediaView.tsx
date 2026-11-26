import { useRenderView } from '@/logic/renderer/useRenderView';
import { MediaBinding } from '@/logic/media/MediaBinding';
import { MediaView as DefaultView } from '@/render/media/MediaView';
import { StudioTab, ComputerUseTab } from './MediaTabs';

export function MediaView() {
  const View = useRenderView('MediaView', DefaultView);
  return <MediaBinding view={View} StudioTab={StudioTab} ComputerUseTab={ComputerUseTab} />;
}
