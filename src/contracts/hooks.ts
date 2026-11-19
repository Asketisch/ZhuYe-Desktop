import type { I18nContextValue } from '@/utils/i18n/context';
export interface HookView {
  name: string;
  kind: string;
  enabled: boolean;
  config_summary: string;
}
export interface HookEventView {
  kind: string;
  description: string;
  decisions: string[];
}
export interface HooksViewProps {
  t: I18nContextValue['t'];
  hooks: HookView[];
  loading: boolean;
  error: string | null;
  pendingName: string | null;
  eventsOpen: boolean;
  eventsLoading: boolean;
  events: HookEventView[];
  onToggle: (hook: HookView) => void;
  onRefresh: () => void;
  onEventsToggle: () => void;
}
