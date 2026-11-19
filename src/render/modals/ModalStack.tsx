import type { ModalStackProps } from '@/contracts/modalStack';

export function ModalStack({ suppressInteractionModals, approvals, questions, askUsers, plan,
  ApprovalModal, QuestionModal, AskUserModal, PlanReadyModal, PlanRequestModal, PromptLayersModal }: ModalStackProps) {
  return <>
    {!suppressInteractionModals && approvals.map((approval) => <ApprovalModal key={`ap-${approval.id}`} approval={approval} />)}
    {!suppressInteractionModals && questions.map((question) => <QuestionModal key={`q-${question.id}`} question={question} />)}
    {!suppressInteractionModals && askUsers.map((askUser) => <AskUserModal key={`u-${askUser.id}`} askUser={askUser} />)}
    {plan && (plan.kind === 'request' ? <PlanRequestModal plan={plan} /> : <PlanReadyModal plan={plan} />)}
    <PromptLayersModal />
  </>;
}
