/**
 * PlanApprovalBar —— 输入框上方的计划审批条（计划不再走全局弹窗）。
 *
 * 计划正文完整渲染在右侧 dock 的「计划」页签（usePlanSurfacing 会自动
 * 打开）；这里只承载两个轻决策：
 * - ready（plan_ready）：同意执行计划（auto_mode）/ 逐项确认
 *   （manual_approve）/ 查看计划；输入框打字发送 = 打回修订（revise）
 *   并以 steer 注入反馈（见 useComposerSubmission）。
 * - request（plan_request）：进入计划模式（manual_approve）/ 暂不进入
 *   （revise）。会话已在计划模式时本条由 usePlanSurfacing 静默应答，
 *   这里渲染 null。
 */
import { ClipboardList, Compass, FileText, NotebookPen, Zap } from 'lucide-react';
import { Button, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import s from '@/render/composer/PlanApprovalBar.module.css';

export function PlanApprovalBar() {
  const { t } = useI18n();
  const pendingPlan = useAgentStore((st) => st.pendingPlan);
  const approvePlan = useAgentStore((st) => st.approvePlan);
  const permissionMode = useAgentStore((st) => st.permissionMode);
  const openPlanInDock = () => {
    const ui = useShellUi.getState();
    ui.setDockMode('inspector');
    ui.setInspectorTab('plan');
    ui.setDockOpen(true);
  };

  if (!pendingPlan) return null;
  const isRequest = pendingPlan.kind === 'request';
  // 已在计划模式下收到 EnterPlanMode：冗余 enter，usePlanSurfacing 会
  // 静默应答 —— 不再重复展示确认条。
  if (isRequest && permissionMode === 'plan') return null;

  const payload = pendingPlan.payload as { task?: string } | null;
  const task = payload?.task ?? '';

  return (
    <div className={s.bar} data-kind={isRequest ? 'request' : 'ready'} data-testid="composer-plan-bar">
      <Icon icon={isRequest ? NotebookPen : ClipboardList} size={14} className={s.icon} />
      <div className={s.body}>
        <span className={s.title}>
          {t(isRequest ? 'plan.bar.requestTitle' : 'plan.bar.readyTitle')}
          {isRequest && task ? ` — ${task}` : ''}
        </span>
        {!isRequest && <span className={s.hint}>{t('plan.bar.readyHint')}</span>}
      </div>
      <div className={s.actions}>
        {isRequest ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void approvePlan(pendingPlan.id, 'manual_approve')}
              leftIcon={<Icon icon={NotebookPen} size={13} />}
              data-testid="plan-bar-enter"
            >
              {t('plan.bar.requestEnter')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void approvePlan(pendingPlan.id, 'revise')}
              data-testid="plan-bar-decline"
            >
              {t('plan.bar.requestDecline')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void approvePlan(pendingPlan.id, 'auto_mode')}
              leftIcon={<Icon icon={Zap} size={13} />}
              data-testid="plan-bar-approve"
            >
              {t('plan.bar.approveExecution')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void approvePlan(pendingPlan.id, 'manual_approve')}
              leftIcon={<Icon icon={Compass} size={13} />}
              data-testid="plan-bar-manual"
            >
              {t('plan.bar.manualApprove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={openPlanInDock}
              leftIcon={<Icon icon={FileText} size={13} />}
              data-testid="plan-bar-view"
            >
              {t('plan.bar.viewPlan')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
