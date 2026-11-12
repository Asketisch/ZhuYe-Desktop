/** 请求进入计划模式；批准与拒绝均使用事件携带的 plan_id。 */
import { useAgentStore, type PendingPlan } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from './index.module.css';

export function PlanRequestModal({ plan }: { plan: PendingPlan }) {
  const { t } = useI18n();
  const approvePlan = useAgentStore((state) => state.approvePlan);
  const payload = plan.payload as { task?: string };
  return (
    <ModalShell
      title={t('modal.planRequest.title')}
      open={true}
      onClose={() => approvePlan(plan.id, 'revise')}
      secondaryAction={{ label: t('modal.planRequest.decline'), onClick: () => approvePlan(plan.id, 'revise') }}
      primaryAction={{ label: t('modal.planRequest.approve'), onClick: () => approvePlan(plan.id, 'manual_approve') }}
    >
      <p className={s.promptText}>{payload?.task}</p>
    </ModalShell>
  );
}
