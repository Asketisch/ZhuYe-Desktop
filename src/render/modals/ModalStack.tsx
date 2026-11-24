import type { ModalStackProps } from '@/contracts/modalStack';

/**
 * 全局模态栈：只处理「必须打断」的挂起交互（工具/钩子审批、提问、
 * 自由文本询问、提示词层）。计划审批不在此列 —— 计划正文与审批动作
 * 走右侧 dock 的「计划」页签 + 输入框上方审批条。
 */
export function ModalStack({ suppressInteractionModals, approvals, questions, askUsers,
  ApprovalModal, QuestionModal, AskUserModal, PromptLayersModal }: ModalStackProps) {
  return <>
    {!suppressInteractionModals && approvals.map((approval) => <ApprovalModal key={`ap-${approval.id}`} approval={approval} />)}
    {!suppressInteractionModals && questions.map((question) => <QuestionModal key={`q-${question.id}`} question={question} />)}
    {!suppressInteractionModals && askUsers.map((askUser) => <AskUserModal key={`u-${askUser.id}`} askUser={askUser} />)}
    <PromptLayersModal />
  </>;
}
