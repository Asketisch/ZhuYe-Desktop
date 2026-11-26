import { PullRequestsBinding } from '@/logic/workbench/git-pulls/PullRequestsBinding';
import { PullRequestsView as DefaultView } from '@/render/workbench/git/PullRequestsView';
import { useRenderView } from '@/logic/harness/renderer/useRenderView';

export function PullRequestsView() {
  const View = useRenderView('PullRequestsView', DefaultView);
  return <PullRequestsBinding view={View} />;
}
