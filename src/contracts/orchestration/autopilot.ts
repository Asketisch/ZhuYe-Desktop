import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeAutopilotConfig } from '@/utils/commands';

export interface AutopilotRunView { id: string; status: string; executedAtMs: number; error?: string | null }
export interface AutopilotViewProps {
  t: I18nContextValue['t'];
  config: ZhuyeAutopilotConfig;
  isEditing: boolean;
  configLoading: boolean;
  configError: boolean;
  agents: string[];
  history: AutopilotRunView[];
  historyLoading: boolean;
  historyError: boolean;
  updating: boolean;
  updateError: boolean;
  onUpdate: <K extends keyof ZhuyeAutopilotConfig>(key: K, value: ZhuyeAutopilotConfig[K]) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}
