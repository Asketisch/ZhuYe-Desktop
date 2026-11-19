import type { I18nContextValue } from '@/utils/i18n/context';

export interface WorkspaceCardView {
  path: string;
  label: string;
  sessionCount: number;
  lastUsedLabel: string;
  isActive: boolean;
}
export interface WorkspaceDirsView {
  main: string;
  additional: string[];
  adding: boolean;
}
export interface WorkspacesViewProps {
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  current?: string | null;
  loading: boolean;
  error: boolean;
  errorMessage: string | null;
  workspaces: WorkspaceCardView[];
  removed: WorkspaceCardView[];
  dirs: WorkspaceDirsView;
  onOpenFolder: () => void;
  onReveal: (path: string) => void;
  onUse: (path: string) => void;
  onRemove: (path: string) => void;
  onAddDir: () => void;
  onRemoveDir: (dir: string) => void;
}
