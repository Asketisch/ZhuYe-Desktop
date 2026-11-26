/**
 * PlanDock —— 右 dock 的「计划」标签页（从 Inspector.PlanTab 迁出）。
 *
 * 节点约束：根节点 `flex:1; min-height:0; overflow-y:auto`，让长计划正文
 * 真能滚动（此前 Inspector 整条链没有滚动容器，用户报告「计划不可滚动」）。
 *
 * 内容：待审批卡片（请求 / 同意执行 / 逐项确认 / 打回修订）→ 计划正文
 * Markdown（终稿优先，草稿兜底）→「已写好但未提交」的提交执行按钮 →
 * TodoWrite 清单 → 排队消息。
 */
import { useShallow } from 'zustand/react/shallow';
import { ListTodo, Send } from 'lucide-react';
import { Button, Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore, selectIsTurnRunning, selectQueuedForActiveSession } from '@/stores/agentStore';
import { markDraftSubmitPending } from '@/logic/shell/planSubmitSignal';
import { Markdown } from '@/components/Markdown';
import s from '@/render/harness/shell/Inspector.module.css';

export function PlanDock() {
  const { t } = useI18n();
  const todos = useAgentStore((st) => st.todos);
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  const plan = useAgentStore((st) => st.plan);
  const planDraft = useAgentStore((st) => st.planDraft);
  const pendingPlan = useAgentStore((st) => st.pendingPlan);
  const approvePlan = useAgentStore((st) => st.approvePlan);
  const exitPlanMode = useAgentStore((st) => st.exitPlanMode);
  const permissionMode = useAgentStore((st) => st.permissionMode);
  const running = useAgentStore(selectIsTurnRunning);

  const hasPending = pendingPlan != null;
  const showRequestCard = pendingPlan?.kind === 'request' && permissionMode !== 'plan';
  const showReadyCard = pendingPlan != null && pendingPlan.kind !== 'request';
  // 草稿已写好但未提交：plan 模式 + 有草稿 + 无 pendingPlan + 回合已结束。
  const showDraftSubmit =
    permissionMode === 'plan' && !plan && !!planDraft && !hasPending && !running;

  const submitDraft = () => {
    markDraftSubmitPending();
    void exitPlanMode();
  };

  return (
    <div className={s.planDock} data-testid="plan-dock">
      {showRequestCard && (
        <section className={s.planPending} data-kind="request" data-testid="plan-dock-pending">
          <h3 className={s.sectionTitle}>
            <Icon icon={ListTodo} size={14} />
            {t('plan.card.pendingTitle')}
          </h3>
          <p className={s.planMeta}>
            {String((pendingPlan?.payload as { task?: string } | null)?.task ?? '')}
          </p>
          <div className={s.planPendingActions}>
            <Button size="sm" variant="primary" onClick={() => void approvePlan(pendingPlan!.id, 'manual_approve')} data-testid="plan-dock-enter">
              {t('plan.card.enter')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void approvePlan(pendingPlan!.id, 'revise')} data-testid="plan-dock-decline">
              {t('plan.card.decline')}
            </Button>
          </div>
        </section>
      )}
      {showReadyCard && (
        <section className={s.planPending} data-kind="ready" data-testid="plan-dock-pending">
          <h3 className={s.sectionTitle}>
            <Icon icon={ListTodo} size={14} />
            {t('plan.card.pendingTitle')}
          </h3>
          <div className={s.planPendingActions}>
            <Button size="sm" variant="primary" onClick={() => void approvePlan(pendingPlan!.id, 'auto_mode')} data-testid="plan-dock-approve">
              {t('plan.card.approveExecution')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void approvePlan(pendingPlan!.id, 'manual_approve')} data-testid="plan-dock-manual">
              {t('plan.card.manualApprove')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void approvePlan(pendingPlan!.id, 'revise')} data-testid="plan-dock-revise">
              {t('plan.card.revise')}
            </Button>
          </div>
        </section>
      )}

      {/* 草稿未提交：给「提交并执行」直达动作（回答「没有提示可执行」）。 */}
      {showDraftSubmit && (
        <section className={s.planPending} data-testid="plan-dock-draft-submit">
          <h3 className={s.sectionTitle}>
            <Icon icon={ListTodo} size={14} />
            {t('inspector.plan.draft')}
          </h3>
          <div className={s.planPendingActions}>
            <Button size="sm" variant="primary" onClick={submitDraft} leftIcon={<Icon icon={Send} size={13} />} data-testid="plan-dock-submit">
              {t('plan.dock.submitAndRun')}
            </Button>
          </div>
        </section>
      )}

      {plan && (
        <>
          <p className={s.planMeta} data-testid="plan-dock-final">
            {plan.status === 'approved' && <span>{t('inspector.plan.approved')}</span>}
            {plan.status === 'rejected' && <span>{t('inspector.plan.rejected')}</span>}
            {plan.path && <code title={plan.path}>{plan.path}</code>}
          </p>
          <div className={s.planDoc} data-testid="plan-dock-body">
            <Markdown text={plan.markdown} />
          </div>
        </>
      )}
      {!plan && planDraft && (
        <>
          <p className={s.planMeta} data-testid="plan-dock-draft">
            <span>{t('inspector.plan.draft')}</span>
            {planDraft.path && <code title={planDraft.path}>{planDraft.path}</code>}
          </p>
          <div className={s.planDoc} data-testid="plan-dock-draft-body">
            <Markdown text={planDraft.markdown} />
          </div>
        </>
      )}
      {todos.length === 0 && !plan && !planDraft && (
        <p className={s.gitEmpty}>{t('inspector.plan.empty')}</p>
      )}
      {todos.length > 0 && <p className={s.planMeta}>{t('inspector.plan.todos')}</p>}
      {todos.map((td, i) => (
        <div key={i} className={s.gitFile} data-status={td.status}>
          <span className={s.gitPath} style={td.status === 'completed' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
            {td.status === 'completed' ? '✓ ' : td.status === 'in_progress' ? '▶ ' : '○ '}
            {td.active_form ?? td.content}
          </span>
        </div>
      ))}
      {queued.length > 0 && (
        <>
          <p className={s.gitEmpty} style={{ marginTop: 12 }}>{t('inspector.plan.queued')}({queued.length})</p>
          {queued.map((qm) => (
            <div key={qm.id} className={s.gitFile}>
              <span className={s.gitPath} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qm.text}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
