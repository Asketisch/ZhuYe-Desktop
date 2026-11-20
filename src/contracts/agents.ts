import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeAgentDef } from '@/logic/agents/useAgentsController';
export type { ZhuyeAgentDef } from '@/logic/agents/useAgentsController';

export interface AgentsViewProps {
  t: I18nContextValue['t'];
  tab: 'defs' | 'subagents';
  onTabChange: (tab: 'defs' | 'subagents') => void;
  activeAgent: { name: string; defFound: boolean; memoryScopes: string[]; injectBudgetChars: number } | null;
  defs: ZhuyeAgentDef[];
  loading: boolean;
  error: boolean;
  isEditing: boolean;
  isMutating: boolean;
  isSwitchingAgent: boolean;
  draft: Record<string, unknown> | null;
  isCreating: boolean;
  onBeginCreate: () => void;
  onBeginEdit: (def: ZhuyeAgentDef) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onSave: () => void;
  onCancel: () => void;
  onActivate: (name: string) => void;
  onRemove: (def: ZhuyeAgentDef) => void;
  AgentEditor: ComponentType<{ draft: any; isCreating: boolean; isSaving: boolean; onPatch: (patch: any) => void; onSave: () => void; onCancel: () => void }>;
  SubagentSpecsPanel: ComponentType;
}
