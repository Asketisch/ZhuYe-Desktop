import { useRenderView } from '@/logic/renderer/useRenderView';
import { ModalStackBinding } from '@/logic/modals/ModalStackBinding';
import { ModalStack as DefaultView } from '@/render/modals/ModalStack';
import { ApprovalModal } from './ApprovalModal';
import { QuestionModal } from './QuestionModal';
import { AskUserModal } from './AskUserModal';
import { PromptLayersModal } from './PromptLayersModal';

/** 全局模态栈 —— 计划审批不在此（右侧 dock 计划页签 + composer 审批条）。 */
export function ModalStack({ suppressInteractionModals = false }: { suppressInteractionModals?: boolean } = {}) {
  const View = useRenderView('ModalStack', DefaultView);
  return <ModalStackBinding view={View} suppressInteractionModals={suppressInteractionModals}
    ApprovalModal={ApprovalModal} QuestionModal={QuestionModal} AskUserModal={AskUserModal}
    PromptLayersModal={PromptLayersModal} />;
}

export { ApprovalModal as ApprovalModalStub };
export { QuestionModal as QuestionModalStub };
export { AskUserModal as AskUserModalStub };
export type { PendingApproval, PendingQuestion, PendingAskUser, PendingPlan } from '@/stores/agentStore';
