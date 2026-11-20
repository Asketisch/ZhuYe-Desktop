import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import type { PlanViewProps, PlanViewSlots } from '@/contracts/plan';

/** 计划页状态与审批动作绑定。 */
export function PlanBinding({ view: View, slots }: { view: ComponentType<PlanViewProps>; slots: PlanViewSlots }) {
  const pendingPlan = useAgentStore((st) => st.pendingPlan);
  const approvePlan = useAgentStore((st) => st.approvePlan);
  const planSteps = useAgentStore((st) => st.planSteps);
  const { t } = useI18n();

  const payload = pendingPlan?.payload as
    | { markdown?: string; plan?: string; summary?: string; steps?: string[] | unknown[]; task?: string }
    | null;

  const planText = payload?.markdown ?? payload?.summary ?? payload?.plan ?? '';
  const taskLabel = payload?.task ?? t('plan.title');
  const steps = Array.isArray(payload?.steps)
    ? payload.steps.map((s: unknown) => String(s))
    : planText.split('\n').filter((l) => l.trim().length > 0 && !l.includes('---'));

  return (
    <View
      t={t}
      planText={planText}
      taskLabel={taskLabel}
      steps={steps}
      planSteps={planSteps.map((step) => ({ index: step.index, title: step.title, status: step.status }))}
      pendingPlan={pendingPlan ? { id: pendingPlan.id, kind: pendingPlan.kind === 'request' ? 'request' : 'plan' } : null}
      onApprove={(id, choice) => void approvePlan(id, choice)}
      slots={slots}
    />
  );
}
