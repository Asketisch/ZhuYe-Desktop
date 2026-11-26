import type { I18nContextValue } from '@/utils/i18n/context';
import type { StatusBarController } from '@/logic/harness/shell/useStatusBarController';
export interface StatusBarProps { t: I18nContextValue['t']; tp: I18nContextValue['tp']; ctrl: StatusBarController }
