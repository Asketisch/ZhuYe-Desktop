import type { I18nContextValue } from '@/utils/i18n/context';

export interface SpanDayFile { day: string }
export interface SpanRow {
  spanId: string;
  event: string;
  timestamp: string;
  depth: number;
  module?: string | null;
  status?: string | null;
  durationMs?: number | null;
  parentSpanId?: string | null;
  turnId?: string | null;
}
export interface SpansPanelViewProps {
  t: I18nContextValue['t'];
  files: SpanDayFile[];
  pickedDay: string | null;
  onDayChange: (value: string | null) => void;
  spans: SpanRow[];
  loading: boolean;
  error: string | null;
  labels: { day: string; noFiles: string; empty: string; emptyHint: string };
}
