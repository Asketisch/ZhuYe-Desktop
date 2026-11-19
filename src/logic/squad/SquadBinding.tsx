import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useSquadController } from './useSquadController';
import type { SquadViewProps } from '@/contracts/squad';

export function SquadBinding({ view: View, SquadTaskRow }: { view: ComponentType<SquadViewProps>; SquadTaskRow: SquadViewProps['SquadTaskRow'] }) {
  const { t, tp } = useI18n(); const ctrl = useSquadController();
  return <View t={t} tp={tp} ctrl={ctrl} SquadTaskRow={SquadTaskRow} />;
}
