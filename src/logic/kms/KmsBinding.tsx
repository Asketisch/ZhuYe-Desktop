import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useKmsController } from './useKmsController';
import type { KmsViewProps } from '@/contracts/connect/kms';

export function KmsBinding({ view: View }: { view: ComponentType<KmsViewProps> }) {
  const { t } = useI18n(); const ctrl = useKmsController();
  return <View t={t} ctrl={ctrl} />;
}
