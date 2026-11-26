import { PullRequestsBinding } from '@/logic/git-pulls/PullRequestsBinding';
import { PullRequestsView as DefaultView } from '@/render/git/PullRequestsView';
import { useRenderView } from '@/logic/renderer/useRenderView';

export function PullRequestsView() {
  const View = useRenderView('PullRequestsView', DefaultView);
  return <PullRequestsBinding view={View} />;
}
