/**
 * BrowserDock —— 右 dock「浏览器」面板切片(渲染/逻辑分离,同 files 等
 * dock 三段式)。
 *
 * DockPanel 在 dockMode === 'browser' 时挂载本组件;逻辑
 * (`useBrowserDockController`)在 logic 层,表现(`BrowserDockView`)
 * 在 render 层 —— 这里只做翻译(t)与 props 组装。
 */
import { useI18n } from '@/utils/i18n';
import { useBrowserDockController } from '@/logic/browser/useBrowserDockController';
import { BrowserDockView } from '@/render/browser/BrowserDockView';

export function BrowserDock() {
  const { t } = useI18n();
  const ctrl = useBrowserDockController();

  const devices = [
    { id: 'desktop', label: t('harness.browser.devDesktop') },
    { id: 'tablet', label: t('harness.browser.devTablet') },
    { id: 'phone', label: t('harness.browser.devPhone') },
  ];

  return (
    <BrowserDockView
      running={ctrl.running}
      frame={ctrl.frame}
      url={ctrl.status?.url ?? null}
      busy={ctrl.busy}
      error={ctrl.error}
      urlDraft={ctrl.urlDraft}
      onUrlDraftChange={ctrl.setUrlDraft}
      onNavigate={ctrl.navigate}
      onBack={ctrl.back}
      onForward={ctrl.forward}
      onReload={ctrl.reload}
      device={ctrl.device}
      devices={devices}
      onDeviceChange={ctrl.changeDevice}
      onStart={ctrl.start}
      onStop={ctrl.stop}
      labels={{
        back: t('harness.browser.back'),
        forward: t('harness.browser.forward'),
        reload: t('harness.browser.reload'),
        urlPlaceholder: t('harness.browser.urlPlaceholder'),
        start: t('harness.browser.start'),
        stop: t('harness.browser.stop'),
        stopHint: t('harness.browser.stopHint'),
        emptyTitle: t('harness.browser.emptyTitle'),
        emptyHint: t('harness.browser.emptyHint'),
        waitFrame: t('harness.browser.waitFrame'),
      }}
    />
  );
}
