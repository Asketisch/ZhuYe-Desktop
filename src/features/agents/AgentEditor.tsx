import { useI18n } from '@/utils/i18n';
import { useRenderView } from '@/logic/renderer/useRenderView';
import { AgentEditorBinding } from '@/logic/agents/AgentEditorBinding';
import { AgentEditor as DefaultView } from '@/render/agents/AgentEditor';
export interface AgentEditorProps { draft: import('@/utils/commands').ReflectAgentDef; isCreating: boolean; isSaving: boolean; onPatch: (patch: Partial<import('@/utils/commands').ReflectAgentDef>) => void; onSave: () => void; onCancel: () => void }
export function AgentEditor(props: AgentEditorProps) { const { t } = useI18n(); const View = useRenderView('AgentEditor', DefaultView); return <AgentEditorBinding view={View} t={t} {...props} />; }
