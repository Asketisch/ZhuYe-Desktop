import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SubagentSpecsBinding } from '@/logic/orchestration/agents/SubagentSpecsBinding';
import { SubagentSpecsPanel as DefaultView } from '@/render/orchestration/agents/SubagentSpecsPanel';
export function SubagentSpecsPanel() { const View = useRenderView('SubagentSpecsPanel', DefaultView); return <SubagentSpecsBinding view={View} />; }
