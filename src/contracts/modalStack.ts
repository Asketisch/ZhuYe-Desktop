import type { ComponentType } from 'react';
import type { PendingApproval, PendingQuestion, PendingAskUser } from '@/stores/agent/types';

/**
 * 全局模态栈契约 —— 只承载「必须打断」的挂起交互。
 *
 * 计划审批（plan_ready / plan_request）不在模态栈内：正文与审批动作走
 * 右侧 dock 的「计划」页签 + 输入框上方审批条（见
 * `features/composer/PlanApprovalBar` 与 `logic/shell/usePlanSurfacing`）。
 */
export interface ModalStackProps {
  suppressInteractionModals: boolean;
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  askUsers: PendingAskUser[];
  ApprovalModal: ComponentType<{ approval: PendingApproval }>;
  QuestionModal: ComponentType<{ question: PendingQuestion }>;
  AskUserModal: ComponentType<{ askUser: PendingAskUser }>;
  PromptLayersModal: ComponentType;
}
