/**
 * Plan —— 计划模式查看器 + 审批工作流（CSS Modules 版）。
 *
 * Plan 审批三选一(对齐 `reflect_protocol::PlanApprovalChoice`):
 *   - Auto Mode(auto_mode):切到 AcceptEdits,自动批准编辑/写入类。
 *   - Manual Approve(manual_approve):切到 Prompt,逐工具审批(旧行为)。
 *   - Revise(revise):留在 plan 模式,用户输入反馈继续 plan。
 *
 * 数据源: 优先从 agentStore 的 pendingPlan 获取当前待审批计划。
 * 计划审批的实际交互通过 PlanReadyModal (ModalStack 内) 处理。
 * 此视图展示当前 plan 状态或空状态。
 */
import { ClipboardList, Check, Pencil, Zap, FileText } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Button, Icon, EmptyState } from '@/features/design-system';
import s from './PlanView.module.css';

export function PlanView() {
  const pendingPlan = useAgentStore((st) => st.pendingPlan);
  const approvePlan = useAgentStore((st) => st.approvePlan);
  const planSteps = useAgentStore((st) => st.planSteps);
  const { t } = useI18n();

  const payload = pendingPlan?.payload as {
    markdown?: string;
    plan?: string;
    summary?: string;
    steps?: string[] | unknown[];
    task?: string;
  } | null;

  const planText = payload?.markdown ?? payload?.summary ?? payload?.plan ?? '';
  const taskLabel = payload?.task ?? t('plan.title');
  const steps = Array.isArray(payload?.steps)
    ? payload.steps.map((s: unknown) => String(s))
    : planText.split('\n').filter((l) => l.trim().length > 0 && !l.includes('---'));

  return (
    <PageShell
      icon={ClipboardList}
      title={t('plan.title')}
      subtitle={t('plan.subtitle')}
      width="md"
    >
      {/* plan 执行进度 —— 来自核心 `plan_step` 事件。审批前只有 plan 正文,
          审批后 agent 逐 step 上报状态;此前这一步完全不可见。 */}
      {planSteps.length > 0 && (
        <Card level="outlined" padding="lg" className={s.planCard} data-testid="plan-steps">
          <div className={s.header}>
            <div className={s.titleRow}>
              <PlanStepBadge status="in_progress" />
              <span className={s.task}>{t('plan.progressTitle')}</span>
            </div>
          </div>
          <ol className={s.steps}>
            {planSteps.map((step) => (
              <li key={step.index} className={s.step} data-status={step.status}>
                <span className={s.stepNum}>{step.index + 1}</span>
                <span className={s.stepText}>{step.title ?? t(`plan.stepStatus.${step.status}`)}</span>
                <PlanStepBadge status={step.status} />
              </li>
            ))}
          </ol>
        </Card>
      )}

      {pendingPlan && (
        <div className={s.list}>
          <Card level="outlined" padding="lg" className={s.planCard} data-status="pending">
            <div className={s.header}>
              <div className={s.titleRow}>
                <PlanStatusBadge status="pending" />
                <span className={s.task}>{taskLabel}</span>
              </div>
            </div>
            {steps.length > 0 && (
              <ol className={s.steps}>
                {steps.map((step: string, i: number) => (
                  <li key={i} className={s.step}>
                    <span className={s.stepNum}>{i + 1}</span>
                    <span className={s.stepText}>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {steps.length === 0 && planText && (
              <pre className={s.planText}>{planText}</pre>
            )}
            <div className={s.actions}>
              {pendingPlan.kind === 'request' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void approvePlan(pendingPlan.id, 'manual_approve')}
                    leftIcon={<Icon icon={Check} size={14} />}
                  >
                    {t('modal.planRequest.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void approvePlan(pendingPlan.id, 'revise')}
                  >
                    {t('modal.planRequest.decline')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void approvePlan(pendingPlan.id, 'auto_mode')}
                    leftIcon={<Icon icon={Zap} size={14} />}
                  >
                    {t('plan.autoMode')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void approvePlan(pendingPlan.id, 'manual_approve')}
                    leftIcon={<Icon icon={Check} size={14} />}
                  >
                    {t('plan.manualApprove')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void approvePlan(pendingPlan.id, 'revise')}
                    leftIcon={<Icon icon={Pencil} size={14} />}
                  >
                    {t('plan.revise')}
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* 什么都没有(既无待审批 plan,也无执行进度)→ 空状态。 */}
      {!pendingPlan && planSteps.length === 0 && (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={FileText} />}
            title={t('plan.empty')}
            description={t('plan.usePlanHint')}
          />
        </Card>
      )}
    </PageShell>
  );
}

function PlanStatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') return <Badge variant="success" solid>approved</Badge>;
  if (status === 'rejected') return <Badge variant="danger" solid>rejected</Badge>;
  return <Badge variant="warning" solid>pending</Badge>;
}

/**
 * plan step 状态徽标 —— 对应核心 `PlanStepStatus`
 * (`pending` / `in_progress` / `done` / `skipped`)。
 */
function PlanStepBadge({ status }: { status: string }) {
  const variant =
    status === 'done'
      ? 'success'
      : status === 'in_progress'
        ? 'accent'
        : status === 'skipped'
          ? 'neutral'
          : 'warning';
  return (
    <Badge variant={variant} data-status={status}>
      {status}
    </Badge>
  );
}
