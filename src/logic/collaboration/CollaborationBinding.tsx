import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { zhuye_list_tools } from '@/utils/commands';
import { useOrchestrationController } from '@/logic/collaboration/useOrchestrationController';
import type { CollaborationViewProps } from '@/contracts/orchestration/collaboration';

export function CollaborationBinding({ view: View, McpManager, PluginsPanel, PipelineEditor }: {
  view: ComponentType<CollaborationViewProps>;
  McpManager: ComponentType;
  PluginsPanel: ComponentType;
  PipelineEditor: ComponentType;
}) {
  const { t } = useI18n();
  const lspServers = useAgentStore((state) => state.lspServers);
  const toolsQuery = useQuery({ queryKey: ['tools'], queryFn: zhuye_list_tools, staleTime: 30_000 });
  const orch = useOrchestrationController();
  const mcpToolCount = (toolsQuery.data ?? []).filter((tool) => tool.name.startsWith('mcp__')).length;
  return <View t={t} lspServers={lspServers} mcpToolCount={mcpToolCount} orch={orch}
    McpManager={McpManager} PluginsPanel={PluginsPanel} PipelineEditor={PipelineEditor} />;
}
