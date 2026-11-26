import { useRenderView } from '@/logic/renderer/useRenderView';
import { SidebarBinding, type SidebarBindingProps } from '@/logic/sessions/SidebarBinding';
import { Sidebar as DefaultView } from '@/render/sessions/Sidebar';
import { WorkspaceGroup } from './WorkspaceGroup';
import { SessionItem } from './SessionItem';
import { SidebarMenu } from './SidebarMenu';

export function Sidebar(props: Omit<SidebarBindingProps, 'view' | 'WorkspaceGroup' | 'SessionItem' | 'SessionMenu'>) {
  const View = useRenderView('Sidebar', DefaultView);
  return <SidebarBinding {...props} view={View} WorkspaceGroup={WorkspaceGroup} SessionItem={SessionItem} SessionMenu={SidebarMenu} />;
}
