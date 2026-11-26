import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { ModalStackProps } from '@/contracts/harness/modalStack';

/** 全局模态栈绑定 —— 计划审批已迁到右侧 dock + composer 审批条，不在此列。 */
export function ModalStackBinding({ view: View, suppressInteractionModals = false, ApprovalModal, QuestionModal, AskUserModal,
  PromptLayersModal }: {
  view: ComponentType<ModalStackProps>;
  suppressInteractionModals?: boolean;
  ApprovalModal: ModalStackProps['ApprovalModal'];
  QuestionModal: ModalStackProps['QuestionModal'];
  AskUserModal: ModalStackProps['AskUserModal'];
  PromptLayersModal: ComponentType;
}) {
  const approvals = useAgentStore((state) => state.pendingApprovals);
  const questions = useAgentStore((state) => state.pendingQuestions);
  const askUsers = useAgentStore((state) => state.pendingAskUser);
  return <View suppressInteractionModals={suppressInteractionModals} approvals={approvals} questions={questions}
    askUsers={askUsers} ApprovalModal={ApprovalModal} QuestionModal={QuestionModal}
    AskUserModal={AskUserModal} PromptLayersModal={PromptLayersModal} />;
}
