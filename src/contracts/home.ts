import type { I18nContextValue } from '@/utils/i18n/context';
export interface HomeRecent { id: string; label: string; startedAt: string; messages: number }
export interface HomeViewProps {
  recent: HomeRecent[];
  activeModel?: { model: string; provider: string };
  onOpen: (to: string) => void;
  onOpenSession: (id: string) => void;
  t: I18nContextValue['t'];
  relative: (value: string) => string;
}
