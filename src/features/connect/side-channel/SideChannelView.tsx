/**
 * SideChannelView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/renderer/useRenderView';
import { SideChannelBinding } from '@/logic/side-channel/SideChannelBinding';
import { SideChannelView as DefaultView } from '@/render/side-channel/SideChannelView';

export function SideChannelView() {
  const View = useRenderView('SideChannelView', DefaultView);
  return <SideChannelBinding view={View} />;
}
