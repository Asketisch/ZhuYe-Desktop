/**
 * modals —— 聚合所有 modal。每个 modal 主体已拆到独立文件,
 * 此处只保留 `ModalStack` 编排 + 向后兼容 stub 导出。
 *
 * - ApprovalModal    → ./ApprovalModal
 * - QuestionModal    → ./QuestionModal
 * - AskUserModal     → ./AskUserModal
 * - PlanReadyModal   → ./PlanReadyModal
 * - PromptLayersModal→ ./PromptLayersModal
 *
 * 行为契约:ModalStack 把 agentStore 的 pendingApprovals / pendingQuestions /
 * pendingAskUser / pendingPlan 渲染为对应 modal;关闭/批准等动作交由 modal
 * 本身 + store action 处理。每个子组件的渲染 DOM 与原内联实现逐字段对齐。
 */
import { useAgentStore } from '@/stores/agentStore';
import { ApprovalModal } from './ApprovalModal';
import { QuestionModal } from './QuestionModal';
import { AskUserModal } from './AskUserModal';
import { PlanReadyModal } from './PlanReadyModal';
import { PlanRequestModal } from './PlanRequestModal';
import { PromptLayersModal } from './PromptLayersModal';

/**
 * 聚合所有 modal。
 * v2(redesign/zcode-shell):chat 路由在交互接管模式(审批/提问/输入以
 * composer 座位卡片呈现)时,通过 `suppressInteractionModals` 抑制同源
 * modal,避免双 UI。plan / prompt 层面板不受影响。
 */
export function ModalStack({ suppressInteractionModals = false }: { suppressInteractionModals?: boolean } = {}) {
  const approvals = useAgentStore((st) => st.pendingApprovals);
  const questions = useAgentStore((st) => st.pendingQuestions);
  const askUsers = useAgentStore((st) => st.pendingAskUser);
  const plan = useAgentStore((st) => st.pendingPlan);

  return (
    <>
      {!suppressInteractionModals && approvals.map((a) => (
        <ApprovalModal key={`ap-${a.id}`} approval={a} />
      ))}
      {!suppressInteractionModals && questions.map((q) => (
        <QuestionModal key={`q-${q.id}`} question={q} />
      ))}
      {!suppressInteractionModals && askUsers.map((u) => (
        <AskUserModal key={`u-${u.id}`} askUser={u} />
      ))}
      {plan && (plan.kind === 'request' ? <PlanRequestModal plan={plan} /> : <PlanReadyModal plan={plan} />)}
      {/* v1.6.1：提示词层面板(`/prompt` slash 打开)—— 进程级,常驻挂载,
          自身按 `promptPanelOpen` 决定是否渲染。 */}
      <PromptLayersModal />
    </>
  );
}

// ====== 向后兼容：旧 stub 名(同模块引用即可) ======
export { ApprovalModal as ApprovalModalStub };
export { QuestionModal as QuestionModalStub };
export { AskUserModal as AskUserModalStub };
export { PlanReadyModal as PlanReadyModalStub };

// Re-export 类型 + 默认命名以保持外部 import 兼容。
export type { PendingApproval, PendingQuestion, PendingAskUser, PendingPlan } from '@/stores/agentStore';
