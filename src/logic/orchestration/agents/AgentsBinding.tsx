import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useAgentsController } from '@/logic/orchestration/agents/useAgentsController';
import type { AgentsViewProps } from '@/contracts/orchestration/agents';

export function AgentsBinding({ view: View, AgentEditor, SubagentSpecsPanel }: {
  view: ComponentType<AgentsViewProps>;
  AgentEditor: AgentsViewProps['AgentEditor'];
  SubagentSpecsPanel: ComponentType;
}) {
  const ctrl = useAgentsController();
  const { t } = useI18n();
  const [tab, setTab] = useState<'defs' | 'subagents'>('defs');
  return <View t={t} tab={tab} onTabChange={setTab}
    activeAgent={ctrl.activeAgent} defs={ctrl.defs} loading={ctrl.loading} error={Boolean(ctrl.error)}
    isEditing={ctrl.isEditing} isMutating={ctrl.isMutating} isSwitchingAgent={ctrl.isSwitchingAgent}
    draft={ctrl.draft as unknown as Record<string, unknown> | null} isCreating={ctrl.isCreating}
    onBeginCreate={ctrl.beginCreate} onBeginEdit={ctrl.beginEdit}
    onPatch={ctrl.patchDraft as unknown as (patch: Record<string, unknown>) => void}
    onSave={() => { void ctrl.save(); }} onCancel={ctrl.cancelEdit}
    onActivate={(name) => { void ctrl.setActiveAgent(name); }}
    onRemove={(def) => { void ctrl.remove(def); }}
    AgentEditor={AgentEditor} SubagentSpecsPanel={SubagentSpecsPanel} />;
}
