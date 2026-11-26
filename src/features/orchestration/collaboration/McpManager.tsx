import { useRenderView } from '@/logic/renderer/useRenderView';
import { McpManagerBinding } from '@/logic/collaboration/McpManagerBinding';
import { McpManager as DefaultView } from '@/render/collaboration/McpManager';
export function McpManager() { const View = useRenderView('McpManager', DefaultView); return <McpManagerBinding view={View} />; }
