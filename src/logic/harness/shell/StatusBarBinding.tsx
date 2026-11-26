import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useStatusBarController } from './useStatusBarController';
import type { StatusBarProps } from '@/contracts/harness/statusBar';
export function StatusBarBinding({ view: View }: { view: ComponentType<StatusBarProps> }) {
  const { t, tp } = useI18n(); const ctrl = useStatusBarController();
  return <View t={t} tp={tp} ctrl={ctrl} />;
}
