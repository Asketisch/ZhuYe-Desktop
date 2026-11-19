import type { RefObject } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { ThemeMode, UiPrefs } from '@/contracts/appearance';
export interface SettingsDisplayProps {
  t: I18nContextValue['t']; prefs: UiPrefs; themeMode: ThemeMode; backgroundUrl: string;
  imageError: string; fileInput: RefObject<HTMLInputElement | null>;
  onThemeChange: (mode: ThemeMode) => void; onUpdate: (patch: Partial<UiPrefs>) => void;
  onLoadImage: (file?: File) => void; onApplyBackgroundUrl: () => void; onClearBackground: () => void;
  onBackgroundUrlChange: (value: string) => void;
}
