import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { WorkspacesBinding } from '@/logic/pages/workspaces/WorkspacesBinding';
import { WorkspacesView as DefaultView } from '@/render/pages/workspaces/WorkspacesView';

export function WorkspacesView() {
  const View = useRenderView('WorkspacesView', DefaultView);
  return <WorkspacesBinding view={View} />;
}
