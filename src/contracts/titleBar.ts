import type { I18nContextValue } from '@/utils/i18n/context';
export interface TitleBarProps {
  t: I18nContextValue['t'];
  pathname: string;
  sessionLabel: string;
  permissionMode: string | null;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
}
