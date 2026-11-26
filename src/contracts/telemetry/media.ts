import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { MediaController, MediaTab } from '@/logic/telemetry/media/useMediaController';
export type { MediaTab } from '@/logic/telemetry/media/useMediaController';

export interface MediaViewProps {
  t: I18nContextValue['t'];
  ctrl: MediaController;
  tab: MediaTab;
  onTabChange: (tab: MediaTab) => void;
  StudioTab: ComponentType<{ ctrl: MediaController }>;
  ComputerUseTab: ComponentType<{ ctrl: MediaController }>;
}
