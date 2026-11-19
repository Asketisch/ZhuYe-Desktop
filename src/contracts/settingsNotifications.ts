import type { I18nContextValue } from '@/utils/i18n/context';
import type { AgentNotifyOptions } from '@/utils/notify';
export interface SettingsNotificationsProps {
  t: I18nContextValue['t']; opts: AgentNotifyOptions; permission: string;
  onPatch: (patch: Partial<AgentNotifyOptions>) => void; onRequestPermission: () => void;
}
