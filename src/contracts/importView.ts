import type { I18nContextValue } from '@/utils/i18n/context';
export interface ImportKindOption {
  value: string;
  labelKey: string;
}
export interface ImportOutcomeView {
  source: string;
  turns?: number;
  records?: number;
  error?: string;
}
export interface ImportResultView {
  imported: ImportOutcomeView[];
  failed: ImportOutcomeView[];
}
export interface ImportViewProps {
  t: I18nContextValue['t'];
  kinds: ImportKindOption[];
  kind: string;
  onKindChange: (kind: string) => void;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  sourcesCount: number | null;
  discoverLoading: boolean;
  running: boolean;
  disabled: boolean;
  result: ImportResultView | null;
  onImport: () => void;
}
