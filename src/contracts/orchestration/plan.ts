import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
export interface PlanStepView {
  index: number;
  title?: string | null;
  status: string;
}
/** plan 正文渲染器 —— 渲染层不直接依赖共享组件，由 features 层注入。 */
export interface PlanViewSlots {
  Markdown: ComponentType<{ text: string }>;
}
export interface PlanViewProps {
  t: I18nContextValue['t'];
  planText: string;
  taskLabel: string;
  steps: string[];
  planSteps: PlanStepView[];
  pendingPlan: { id: string; kind: 'request' | 'plan' } | null;
  onApprove: (id: string, choice: 'auto_mode' | 'manual_approve' | 'revise') => void;
  slots: PlanViewSlots;
}
