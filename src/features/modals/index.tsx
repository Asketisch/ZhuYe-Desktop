import { useRenderView } from '@/logic/renderer/useRenderView';
import { ModalStackBinding } from '@/logic/modals/ModalStackBinding';
import { ModalStack as DefaultView } from '@/render/modals/ModalStack';
import { ApprovalModal } from './ApprovalModal';
import { QuestionModal } from './QuestionModal';
import { AskUserModal } from './AskUserModal';
import { PlanReadyModal } from './PlanReadyModal';
import { PlanRequestModal } from './PlanRequestModal';
import { PromptLayersModal } from './PromptLayersModal';

export function ModalStack({ suppressInteractionModals = false }: { suppressInteractionModals?: boolean } = {}) {
  const View = useRenderView('ModalStack', DefaultView);
  return <ModalStackBinding view={View} suppressInteractionModals={suppressInteractionModals}
    ApprovalModal={ApprovalModal} QuestionModal={QuestionModal} AskUserModal={AskUserModal}
    PlanReadyModal={PlanReadyModal} PlanRequestModal={PlanRequestModal} PromptLayersModal={PromptLayersModal} />;
}

export { ApprovalModal as ApprovalModalStub };
export { QuestionModal as QuestionModalStub };
export { AskUserModal as AskUserModalStub };
export { PlanReadyModal as PlanReadyModalStub };
export type { PendingApproval, PendingQuestion, PendingAskUser, PendingPlan } from '@/stores/agentStore';
