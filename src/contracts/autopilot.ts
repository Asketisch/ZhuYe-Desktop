import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectAutopilotConfig } from '@/utils/commands';

export interface AutopilotRunView { id: string; status: string; executedAtMs: number; error?: string | null }
export interface AutopilotViewProps {
  t: I18nContextValue['t'];
  config: ReflectAutopilotConfig;
  isEditing: boolean;
  configLoading: boolean;
  configError: boolean;
  agents: string[];
  history: AutopilotRunView[];
  historyLoading: boolean;
  historyError: boolean;
  updating: boolean;
  updateError: boolean;
  onUpdate: <K extends keyof ReflectAutopilotConfig>(key: K, value: ReflectAutopilotConfig[K]) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}
