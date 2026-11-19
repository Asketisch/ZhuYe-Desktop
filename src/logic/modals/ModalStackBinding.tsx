import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { ModalStackProps } from '@/contracts/modalStack';

export function ModalStackBinding({ view: View, suppressInteractionModals = false, ApprovalModal, QuestionModal, AskUserModal,
  PlanReadyModal, PlanRequestModal, PromptLayersModal }: {
  view: ComponentType<ModalStackProps>;
  suppressInteractionModals?: boolean;
  ApprovalModal: ModalStackProps['ApprovalModal'];
  QuestionModal: ModalStackProps['QuestionModal'];
  AskUserModal: ModalStackProps['AskUserModal'];
  PlanReadyModal: ModalStackProps['PlanReadyModal'];
  PlanRequestModal: ModalStackProps['PlanRequestModal'];
  PromptLayersModal: ComponentType;
}) {
  const approvals = useAgentStore((state) => state.pendingApprovals);
  const questions = useAgentStore((state) => state.pendingQuestions);
  const askUsers = useAgentStore((state) => state.pendingAskUser);
  const plan = useAgentStore((state) => state.pendingPlan);
  return <View suppressInteractionModals={suppressInteractionModals} approvals={approvals} questions={questions}
    askUsers={askUsers} plan={plan} ApprovalModal={ApprovalModal} QuestionModal={QuestionModal}
    AskUserModal={AskUserModal} PlanReadyModal={PlanReadyModal}
    PlanRequestModal={PlanRequestModal} PromptLayersModal={PromptLayersModal} />;
}
