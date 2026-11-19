import { useRenderView } from '@/logic/renderer/useRenderView';
import { SubagentSpecsBinding } from '@/logic/agents/SubagentSpecsBinding';
import { SubagentSpecsPanel as DefaultView } from '@/render/agents/SubagentSpecsPanel';
export function SubagentSpecsPanel() { const View = useRenderView('SubagentSpecsPanel', DefaultView); return <SubagentSpecsBinding view={View} />; }
