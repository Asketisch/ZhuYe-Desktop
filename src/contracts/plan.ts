import type { I18nContextValue } from '@/utils/i18n/context';
export interface PlanStepView {
  index: number;
  title?: string | null;
  status: string;
}
export interface PlanViewProps {
  t: I18nContextValue['t'];
  planText: string;
  taskLabel: string;
  steps: string[];
  planSteps: PlanStepView[];
  pendingPlan: { id: string; kind: 'request' | 'plan' } | null;
  onApprove: (id: string, choice: 'auto_mode' | 'manual_approve' | 'revise') => void;
}
