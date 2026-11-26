import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeFileSearchHit, ZhuyeSessionSearchHit, SearchRank } from '@/utils/commands';
export type SearchTab = 'sessions' | 'files';
export interface SearchViewProps {
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  tab: SearchTab;
  query: string;
  rank: SearchRank;
  sessionHits: ZhuyeSessionSearchHit[];
  fileHits: ZhuyeFileSearchHit[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  onTabChange: (tab: SearchTab) => void;
  onQueryChange: (value: string) => void;
  onToggleRank: () => void;
  onOpenSession: (id: string) => void;
  onOpenFile: (path: string, line: number) => void;
}
