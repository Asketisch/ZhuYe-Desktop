import type { I18nContextValue } from '@/utils/i18n/context';
export type { LocaleKey } from '@/utils/i18n';
export interface ActivityBarProps {
  t: I18nContextValue['t'];
  pathname: string;
  simple: boolean;
  moreOpen: boolean;
  moreWrapRef: React.RefObject<HTMLDivElement | null>;
  onToggleMore: () => void;
  onNavigate: (to: string) => void;
}
