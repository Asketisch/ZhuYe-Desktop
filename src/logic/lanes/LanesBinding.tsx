import type { ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useI18n } from '@/utils/i18n';
import { useLanesController } from './useLanesController';
import type { LanesViewProps } from '@/contracts/lanes';

/** 将泳道状态与动作交给调用方提供的展示组件。 */
export function LanesBinding({ view: View }: { view: ComponentType<LanesViewProps> }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ctrl = useLanesController();

  return (
    <View
      t={t}
      sessionLabel={ctrl.sessionLabel}
      runningCount={ctrl.runningCount}
      doneCount={ctrl.doneCount}
      failedCount={ctrl.failedCount}
      lanes={ctrl.lanes}
      hasRunning={ctrl.hasRunning}
      busy={ctrl.busy}
      onBack={() => void navigate({ to: '/' })}
      onRefresh={ctrl.refresh}
      onCancelAll={() => void ctrl.cancelAll()}
    />
  );
}
