import { useRenderView } from '@/logic/renderer/useRenderView';
import { WorkspacesBinding } from '@/logic/workspaces/WorkspacesBinding';
import { WorkspacesView as DefaultView } from '@/render/workspaces/WorkspacesView';

export function WorkspacesView() {
  const View = useRenderView('WorkspacesView', DefaultView);
  return <WorkspacesBinding view={View} />;
}
