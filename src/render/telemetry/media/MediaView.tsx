import { Image as ImageIcon } from 'lucide-react';
import type { MediaTab, MediaViewProps } from '@/contracts/telemetry/media';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Badge } from '@/render/harness/design-system/Badge';
import { SegmentedControl, type SegmentedOption } from '@/render/harness/design-system/SegmentedControl';
import s from './MediaView.module.css';

export function MediaView({ t, ctrl, tab, onTabChange, StudioTab, ComputerUseTab }: MediaViewProps) {
  const tabOptions: SegmentedOption<MediaTab>[] = [{ value: 'studio' as const, label: t('media.studio') }, { value: 'computer' as const, label: t('media.computerUse') }];
  return (
    <PageShell
      icon={ImageIcon}
      title={t('media.title')}
      subtitle={t('media.subtitle')}
      width="lg"
    >
      <div className={s.tabBar}>
        <SegmentedControl<MediaTab> options={tabOptions} value={tab} onChange={onTabChange} />
      </div>

      {ctrl.capabilities && (
        <div className={s.capsLine}>
          <Badge variant="neutral">{t('media.capImage', { backend: ctrl.capabilities.imageBackend })}</Badge>
          <Badge variant="neutral">{t('media.capComputer', { backend: ctrl.capabilities.computerBackend })}</Badge>
          <span className={s.capsNote}>{ctrl.capabilities.note}</span>
        </div>
      )}

      {ctrl.tab === 'studio' ? <StudioTab ctrl={ctrl} /> : <ComputerUseTab ctrl={ctrl} />}
    </PageShell>
  );
}
