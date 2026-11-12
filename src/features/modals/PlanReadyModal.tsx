/**
 * PlanReadyModal —— 计划展示 + 审批弹窗（聚焦版,三选一）。
 *
 * Plan 审批对齐 `reflect_protocol::PlanApprovalChoice` 三选一:
 *   - Revise(revise):留在 plan 模式,用户输入反馈继续 plan(等价旧行为的 reject)。
 *   - Manual Approve(manual_approve):切到 Prompt,逐工具审批。
 *   - Auto Mode(auto_mode):切到 AcceptEdits,自动批准编辑/写入类(autoFocus)。
 *
 * 行为契约:
 *   - title 为 i18n `modal.planReady.title`。
 *   - 显示协议中的 plan markdown。
 *   - 按钮层级：tertiary Revise / secondary Manual Approve / primary Auto Mode。
 *   - onClose 走 store `approvePlan(id, 'revise')`(等价 dismiss)。
 */
import { useAgentStore, type PendingPlan } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';
import s from './index.module.css';

export function PlanReadyModal({ plan }: { plan: PendingPlan }) {
  const { t } = useI18n();
  const approvePlan = useAgentStore((st) => st.approvePlan);
  const payload = plan.payload as { markdown?: string; plan?: string; summary?: string };
  const planText = payload?.markdown ?? payload?.summary ?? payload?.plan ?? JSON.stringify(plan.payload, null, 2);
  return (
    <ModalShell
      title={t('modal.planReady.title')}
      open={true}
      onClose={() => approvePlan(plan.id, 'revise')}
      tertiaryAction={{
        label: t('modal.planReady.reject'),
        onClick: () => approvePlan(plan.id, 'revise'),
      }}
      secondaryAction={{
        label: t('modal.planReady.manualApprove'),
        onClick: () => approvePlan(plan.id, 'manual_approve'),
      }}
      primaryAction={{
        label: t('modal.planReady.approve'),
        onClick: () => approvePlan(plan.id, 'auto_mode'),
        autoFocus: true,
      }}
    >
      <pre className={s.planBlock}>{planText}</pre>
      <p className={s.hint}>
        {t('modal.planReady.hint')}
      </p>
    </ModalShell>
  );
}
