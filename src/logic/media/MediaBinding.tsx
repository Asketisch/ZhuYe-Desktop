import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useMediaController, type MediaTab } from './useMediaController';
import type { MediaViewProps } from '@/contracts/media';

export function MediaBinding({ view: View, StudioTab, ComputerUseTab }: {
  view: ComponentType<MediaViewProps>;
  StudioTab: MediaViewProps['StudioTab'];
  ComputerUseTab: MediaViewProps['ComputerUseTab'];
}) {
  const { t } = useI18n(); const ctrl = useMediaController(); const [tab, setTab] = useState<MediaTab>('studio');
  return <View t={t} ctrl={ctrl} tab={tab} onTabChange={setTab} StudioTab={StudioTab} ComputerUseTab={ComputerUseTab} />;
}
