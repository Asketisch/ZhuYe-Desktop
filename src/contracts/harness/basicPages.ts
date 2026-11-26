import type { I18nContextValue } from '@/utils/i18n/context';

export interface AboutViewProps {
  t: I18nContextValue['t'];
  version: string;
  date: string;
  status?: { model: string; workspace: string; has_model: boolean };
}
export interface AppsViewProps { t: I18nContextValue['t'] }
export interface DebugViewProps { stateJson: string; events: string[] }
