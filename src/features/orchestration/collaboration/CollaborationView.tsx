import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { CollaborationBinding } from '@/logic/orchestration/collaboration/CollaborationBinding';
import { CollaborationView as DefaultView } from '@/render/orchestration/collaboration/CollaborationView';
import { McpManager } from './McpManager';
import { PluginsPanel } from './PluginsPanel';
import { PipelineEditor } from './PipelineEditor';

export function CollaborationView() {
  const View = useRenderView('CollaborationView', DefaultView);
  return <CollaborationBinding view={View} McpManager={McpManager} PluginsPanel={PluginsPanel} PipelineEditor={PipelineEditor} />;
}
