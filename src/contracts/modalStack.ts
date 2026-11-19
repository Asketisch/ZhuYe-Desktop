import type { ComponentType } from 'react';
import type { PendingApproval, PendingQuestion, PendingAskUser, PendingPlan } from '@/stores/agent/types';

export interface ModalStackProps {
  suppressInteractionModals: boolean;
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  askUsers: PendingAskUser[];
  plan: PendingPlan | null;
  ApprovalModal: ComponentType<{ approval: PendingApproval }>;
  QuestionModal: ComponentType<{ question: PendingQuestion }>;
  AskUserModal: ComponentType<{ askUser: PendingAskUser }>;
  PlanReadyModal: ComponentType<{ plan: PendingPlan }>;
  PlanRequestModal: ComponentType<{ plan: PendingPlan }>;
  PromptLayersModal: ComponentType;
}
