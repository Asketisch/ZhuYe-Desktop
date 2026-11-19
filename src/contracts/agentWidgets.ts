import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectAgentDef, ReflectMemoryScope } from '@/utils/commands';
import type { SubagentSpecInfo } from '@/utils/commands/subagents';

export interface AgentEditorViewProps {
  t: I18nContextValue['t'];
  draft: ReflectAgentDef;
  isCreating: boolean;
  isSaving: boolean;
  onPatch: (patch: Partial<ReflectAgentDef>) => void;
  onSave: () => void;
  onCancel: () => void;
  memoryScopes: ReflectMemoryScope[];
}

export interface SubagentSpecsViewProps {
  t: I18nContextValue['t'];
  specs: SubagentSpecInfo[];
  loading: boolean;
  editing: { role: string; markdown: string } | null;
  savePending: boolean;
  saveError: string | null;
  onOpenEditor: (role: string) => void;
  onCancelEditor: () => void;
  onChangeMarkdown: (value: string) => void;
  onSave: () => void;
  onDelete: (role: string) => void;
}
