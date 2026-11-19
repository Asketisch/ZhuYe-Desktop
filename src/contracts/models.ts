import type { I18nContextValue } from '@/utils/i18n/context';
import type { PlanEntry } from '@/logic/settings/config/plans';
import type { Effort } from '@/logic/composer/useEffortCapability';

export interface ModelsPlanView extends PlanEntry {
  isDefault: boolean;
  switching: boolean;
}
export interface ModelsEffortOption {
  value: Effort;
  label: string;
  hint: string;
}
export interface ModelsViewProps {
  t: I18nContextValue['t'];
  loading: boolean;
  hasModel: boolean;
  model: string | undefined;
  workspace: string | undefined;
  degradedReason: string | null;
  plans: ModelsPlanView[];
  effort: Effort;
  effortOptions: ModelsEffortOption[];
  effortAdjusted: boolean;
  effortEffective: string | null;
  saved: boolean;
  onGoSettings: () => void;
  onSwitchPlan: (plan: ModelsPlanView) => void;
  onEffortChange: (effort: Effort) => void;
  onApplyEffort: () => void;
}
