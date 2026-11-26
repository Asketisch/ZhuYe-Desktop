/**
 * SideChannelView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SideChannelBinding } from '@/logic/connect/side-channel/SideChannelBinding';
import { SideChannelView as DefaultView } from '@/render/connect/side-channel/SideChannelView';

export function SideChannelView() {
  const View = useRenderView('SideChannelView', DefaultView);
  return <SideChannelBinding view={View} />;
}
