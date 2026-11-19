import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useSubagentSpecs } from './useSubagentSpecs';
import type { SubagentSpecsViewProps } from '@/contracts/agentWidgets';
export function SubagentSpecsBinding({ view: View }: { view: ComponentType<SubagentSpecsViewProps> }) {
  const { t } = useI18n(); const ctrl = useSubagentSpecs();
  return <View t={t} specs={ctrl.specs} loading={ctrl.loading} editing={ctrl.editing}
    savePending={ctrl.savePending} saveError={ctrl.saveError}
    onOpenEditor={(role) => { void ctrl.openEditor(role); }} onCancelEditor={() => ctrl.setEditing(null)}
    onChangeMarkdown={(value) => ctrl.setEditing((previous) => previous ? { ...previous, markdown: value } : previous)}
    onSave={() => { void ctrl.save(); }} onDelete={(role) => { void ctrl.deleteSpec(role); }} />;
}
