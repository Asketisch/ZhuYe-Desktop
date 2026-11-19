import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReactNode } from 'react';

export interface TraceSessionRow {
  sessionId: string;
  title: string;
  calls: number;
  lastAt: string;
  model?: string | null;
  lastSource?: string | null;
}

export interface TraceCallRow {
  requestId: string;
  durationMs: number;
  attempt: number;
  querySource: string;
  model: { modelId: string; providerId?: string | null };
  usage: { input_tokens: number; output_tokens: number; cached_tokens?: number; cache_write_tokens?: number; total_tokens?: number; cost_usd?: number | null };
  request: unknown;
  response: unknown;
}

export interface TracesViewProps {
  t: I18nContextValue['t'];
  iconName: 'activity';
  title: string;
  subtitle: string;
  width: 'sm' | 'md' | 'lg';
  tab: 'calls' | 'spans';
  onTabChange: (tab: 'calls' | 'spans') => void;

  sessions: TraceSessionRow[];
  loading: boolean;
  listError: string | null;
  selectedId: string | null;
  calls: TraceCallRow[];
  callsLoading: boolean;
  callsError: string | null;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  spansSlot: ReactNode;
  labels: {
    tabs: string; callTab: string; spanTab: string; sessionList: string; callsUnit: string;
    detailTitle: string; loading: string; usageTitle: string; empty: string; emptyHint: string;
    selectPrompt: string; refresh: string;
  };
}
