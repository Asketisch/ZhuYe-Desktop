import type { I18nContextValue } from '@/utils/i18n/context';
export interface LivePortView {
  port: number;
  open: boolean;
  url: string;
}
export interface HtmlPreviewProps {
  t: I18nContextValue['t'];
  relPath: string;
  onPathChange: (value: string) => void;
  onOpen: () => void;
  disabled: boolean;
  workspace: string | null;
  content: string;
  isHtml: boolean;
  loading: boolean;
  error: boolean;
  ports: LivePortView[];
}
