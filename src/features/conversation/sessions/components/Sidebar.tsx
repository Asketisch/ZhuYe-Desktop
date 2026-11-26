import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SidebarBinding, type SidebarBindingProps } from '@/logic/conversation/sessions/SidebarBinding';
import { Sidebar as DefaultView } from '@/render/conversation/sessions/Sidebar';
import { WorkspaceGroup } from './WorkspaceGroup';
import { SessionItem } from './SessionItem';
import { SidebarMenu } from './SidebarMenu';

export function Sidebar(props: Omit<SidebarBindingProps, 'view' | 'WorkspaceGroup' | 'SessionItem' | 'SessionMenu'>) {
  const View = useRenderView('Sidebar', DefaultView);
  return <SidebarBinding {...props} view={View} WorkspaceGroup={WorkspaceGroup} SessionItem={SessionItem} SessionMenu={SidebarMenu} />;
}
