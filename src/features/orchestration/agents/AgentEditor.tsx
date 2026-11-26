import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { AgentEditorBinding } from '@/logic/orchestration/agents/AgentEditorBinding';
import { AgentEditor as DefaultView } from '@/render/orchestration/agents/AgentEditor';
export interface AgentEditorProps { draft: import('@/utils/commands').ZhuyeAgentDef; isCreating: boolean; isSaving: boolean; onPatch: (patch: Partial<import('@/utils/commands').ZhuyeAgentDef>) => void; onSave: () => void; onCancel: () => void }
export function AgentEditor(props: AgentEditorProps) { const { t } = useI18n(); const View = useRenderView('AgentEditor', DefaultView); return <AgentEditorBinding view={View} t={t} {...props} />; }
