import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { McpManagerBinding } from '@/logic/orchestration/collaboration/McpManagerBinding';
import { McpManager as DefaultView } from '@/render/orchestration/collaboration/McpManager';
export function McpManager() { const View = useRenderView('McpManager', DefaultView); return <McpManagerBinding view={View} />; }
