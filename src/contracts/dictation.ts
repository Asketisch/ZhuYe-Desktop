import type { I18nContextValue } from '@/utils/i18n/context';

export interface DictationViewProps {
  t: I18nContextValue['t'];
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  error: string | null;
  holdMode: boolean;
  copyOk: boolean;
  onToggleListen: () => void;
  onHoldModeChange: (value: boolean) => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onReset: () => void;
  onCopy: () => void;
  onInsert?: (text: string) => void;
}
