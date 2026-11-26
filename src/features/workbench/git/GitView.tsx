import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { GitBinding } from '@/logic/workbench/git/GitBinding';
import { GitView as DefaultView } from '@/render/workbench/git/GitView';
import { DiffViewer } from './DiffViewer';
import { WorktreePanel } from './WorktreePanel';

export function GitView() {
  const View = useRenderView('GitView', DefaultView);
  return <GitBinding view={View} DiffViewer={DiffViewer} WorktreePanel={WorktreePanel} />;
}
