import { useRenderView } from '@/logic/renderer/useRenderView';
import { ThreadsBinding } from '@/logic/threads/ThreadsBinding';
import { ThreadsView as DefaultView } from '@/render/threads/ThreadsView';
import { ThreadBucketGroup } from './components/ThreadBucketGroup';

export function ThreadsView() {
  const View = useRenderView('ThreadsView', DefaultView);
  return <ThreadsBinding view={View} BucketGroup={ThreadBucketGroup} />;
}
