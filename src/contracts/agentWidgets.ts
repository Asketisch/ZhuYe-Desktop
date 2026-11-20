import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeAgentDef, ZhuyeMemoryScope } from '@/utils/commands';
import type { SubagentSpecInfo } from '@/utils/commands/subagents';

export interface AgentEditorViewProps {
  t: I18nContextValue['t'];
  draft: ZhuyeAgentDef;
  isCreating: boolean;
  isSaving: boolean;
  onPatch: (patch: Partial<ZhuyeAgentDef>) => void;
  onSave: () => void;
  onCancel: () => void;
  memoryScopes: ZhuyeMemoryScope[];
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
