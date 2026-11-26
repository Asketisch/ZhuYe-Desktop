import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { OrchestrationController } from '@/logic/collaboration/useOrchestrationController';

export interface CollaborationViewProps {
  t: I18nContextValue['t'];
  lspServers: Array<{ name: string; status: string; detail?: string | null }>;
  mcpToolCount: number;
  orch: OrchestrationController;
  McpManager: ComponentType;
  PluginsPanel: ComponentType;
  PipelineEditor: ComponentType;
}
