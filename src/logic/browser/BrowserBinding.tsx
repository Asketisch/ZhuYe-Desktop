import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useBrowserController } from '@/logic/browser/useBrowserController';
import type { BrowserPanelProps } from '@/contracts/browser';

/** 浏览器面板绑定:控制器 → 视图 props。 */
export function BrowserBinding({ view: View }: { view: ComponentType<BrowserPanelProps> }) {
  const { t } = useI18n();
  const { status, frame, busy, error, start, stop, refresh } = useBrowserController();
  return (
    <View
      t={t}
      status={status}
      frame={frame}
      busy={busy}
      error={error}
      onStart={() => { void start(); }}
      onStop={() => { void stop(); }}
      onRefresh={() => { void refresh(); }}
    />
  );
}
