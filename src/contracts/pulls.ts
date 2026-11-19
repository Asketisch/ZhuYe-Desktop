import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectGhPullRequest } from '@/utils/commands';

export interface PullRequestsViewProps {
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  prs: ReflectGhPullRequest[];
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}
