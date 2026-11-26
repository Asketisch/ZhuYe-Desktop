import { ClipboardList, Check, Pencil, Zap, FileText } from 'lucide-react';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { Badge } from '@/render/harness/design-system/Badge';
import { Button } from '@/render/harness/design-system/Button';
import { Icon } from '@/render/harness/design-system/Icon';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import type { PlanViewProps } from '@/contracts/orchestration/plan';
import s from './PlanView.module.css';

function PlanStatusBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge variant="success" solid>approved</Badge>;
  if (status === 'rejected') return <Badge variant="danger" solid>rejected</Badge>;
  return <Badge variant="warning" solid>pending</Badge>;
}
function PlanStepBadge({ status }: { status: string }) {
  const variant = status === 'done' ? 'success' : status === 'in_progress' ? 'accent' : status === 'skipped' ? 'neutral' : 'warning';
  return <Badge variant={variant} data-status={status}>{status}</Badge>;
}

export function PlanView({ t, planText, taskLabel, steps, planSteps, pendingPlan, onApprove, slots }: PlanViewProps) {
  const { Markdown } = slots;
  return (
    <PageShell icon={ClipboardList} title={t('plan.title')} subtitle={t('plan.subtitle')} width="md">
      {planSteps.length > 0 && (
        <Card level="outlined" padding="lg" className={s.planCard} data-testid="plan-steps">
          <div className={s.header}><div className={s.titleRow}><PlanStepBadge status="in_progress" /><span className={s.task}>{t('plan.progressTitle')}</span></div></div>
          <ol className={s.steps}>{planSteps.map((step) => (
            <li key={step.index} className={s.step} data-status={step.status}><span className={s.stepNum}>{step.index + 1}</span><span className={s.stepText}>{step.title ?? t(`plan.stepStatus.${step.status}`)}</span><PlanStepBadge status={step.status} /></li>
          ))}</ol>
        </Card>
      )}
      {pendingPlan && (
        <div className={s.list}>
          <Card level="outlined" padding="lg" className={s.planCard} data-status="pending">
            <div className={s.header}><div className={s.titleRow}><PlanStatusBadge status="pending" /><span className={s.task}>{taskLabel}</span></div></div>
            {steps.length > 0 && <ol className={s.steps}>{steps.map((step, i) => <li key={i} className={s.step}><span className={s.stepNum}>{i + 1}</span><span className={s.stepText}>{step}</span></li>)}</ol>}
            {steps.length === 0 && planText && (
              <div className={s.planText}>
                <Markdown text={planText} />
              </div>
            )}
            <div className={s.actions}>
              {pendingPlan.kind === 'request' ? (
                <>
                  <Button variant="primary" size="sm" onClick={() => onApprove(pendingPlan.id, 'manual_approve')} leftIcon={<Icon icon={Check} size={14} />}>{t('plan.bar.requestEnter')}</Button>
                  <Button variant="secondary" size="sm" onClick={() => onApprove(pendingPlan.id, 'revise')}>{t('plan.bar.requestDecline')}</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" size="sm" onClick={() => onApprove(pendingPlan.id, 'auto_mode')} leftIcon={<Icon icon={Zap} size={14} />}>{t('plan.bar.approveExecution')}</Button>
                  <Button variant="primary" size="sm" onClick={() => onApprove(pendingPlan.id, 'manual_approve')} leftIcon={<Icon icon={Check} size={14} />}>{t('plan.bar.manualApprove')}</Button>
                  <Button variant="danger" size="sm" onClick={() => onApprove(pendingPlan.id, 'revise')} leftIcon={<Icon icon={Pencil} size={14} />}>{t('plan.revise')}</Button>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
      {!pendingPlan && planSteps.length === 0 && (
        <Card level="flat" padding="none"><EmptyState icon={<Icon icon={FileText} />} title={t('plan.empty')} description={t('plan.usePlanHint')} /></Card>
      )}
    </PageShell>
  );
}
