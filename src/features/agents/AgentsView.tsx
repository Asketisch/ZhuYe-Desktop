import { useRenderView } from '@/logic/renderer/useRenderView';
import { AgentsBinding } from '@/logic/agents/AgentsBinding';
import { AgentsView as DefaultView } from '@/render/agents/AgentsView';
import { AgentEditor } from './AgentEditor';
import { SubagentSpecsPanel } from './SubagentSpecsPanel';

export { joinCsv, parseCsv } from '@/logic/agents/useAgentsController';

export function AgentsView() {
  const View = useRenderView('AgentsView', DefaultView);
  return <AgentsBinding view={View} AgentEditor={AgentEditor} SubagentSpecsPanel={SubagentSpecsPanel} />;
}
