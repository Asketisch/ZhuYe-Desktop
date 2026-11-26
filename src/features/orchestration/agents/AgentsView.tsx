import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { AgentsBinding } from '@/logic/orchestration/agents/AgentsBinding';
import { AgentsView as DefaultView } from '@/render/orchestration/agents/AgentsView';
import { AgentEditor } from './AgentEditor';
import { SubagentSpecsPanel } from './SubagentSpecsPanel';

export { joinCsv, parseCsv } from '@/logic/orchestration/agents/useAgentsController';

export function AgentsView() {
  const View = useRenderView('AgentsView', DefaultView);
  return <AgentsBinding view={View} AgentEditor={AgentEditor} SubagentSpecsPanel={SubagentSpecsPanel} />;
}
