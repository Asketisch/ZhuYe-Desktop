import type { I18nContextValue } from '@/utils/i18n/context';

export interface SkillRowView {
  name: string;
  path: string;
  description: string;
  bundled?: boolean;
  triggers: string[];
  tools: string[];
  whenPaths: string[];
}
export interface ToolGroupView {
  title: string;
  variant: 'neutral' | 'accent';
  tools: { name: string; description: string }[];
}
export interface SkillsViewProps {
  t: I18nContextValue['t'];
  loading: boolean;
  error: boolean;
  skills: SkillRowView[];
  toolGroups: ToolGroupView[];
  toolCount: number;
  repo: string;
  installing: boolean;
  onRepoChange: (value: string) => void;
  onInstall: () => void;
}
