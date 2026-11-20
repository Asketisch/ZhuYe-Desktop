/**
 * BrowserDock —— 右 dock「浏览器」面板切片(渲染/逻辑分离,同 files 等
 * dock 三段式)。
 *
 * DockPanel 在 dockMode === 'browser' 时挂载本组件;逻辑
 * (`useBrowserDockController`)在 logic 层,表现(`BrowserDockView`)
 * 在 render 层 —— 这里只做翻译(t)与 props 组装,并把画面上的指针 /
 * 键盘事件翻译成 CDP Input 域命令(经 `zhuye_browser_input`)。
 *
 * 坐标：画面按 `max-width: 100%` 缩放显示,故送**归一化坐标**(0..1),
 * 由后端按页面 CSS 视口换算 —— 面板缩放不影响落点。
 */
import { useCallback, useRef } from 'react';
import { useI18n } from '@/utils/i18n';
import { useBrowserDockController } from '@/logic/browser/useBrowserDockController';
import { normalizedPoint, printableText, trackClick, type ClickState } from '@/logic/browser/browserInput';
import { browserModifiersFrom } from '@/utils/commands/browser';
import { BrowserDockView } from '@/render/browser/BrowserDockView';

export function BrowserDock() {
  const { t } = useI18n();
  const ctrl = useBrowserDockController();
  // 双击判定状态(上一次点击的时间与位置)。
  const clickRef = useRef<ClickState | null>(null);

  const devices = [
    { id: 'desktop', label: t('harness.browser.devDesktop') },
    { id: 'tablet', label: t('harness.browser.devTablet') },
    { id: 'phone', label: t('harness.browser.devPhone') },
  ];

  /** 画面元素的矩形(归一化坐标的基准)。 */
  const rectOf = (el: Element) => el.getBoundingClientRect();

  const onFramePointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    const rect = rectOf(e.currentTarget);
    const { x, y } = normalizedPoint(e.clientX, e.clientY, rect);
    const { count, state } = trackClick(clickRef.current, Date.now(), x, y);
    clickRef.current = state;
    // 按下即聚焦画面 → 随后的键盘输入直接进页面。
    e.currentTarget.focus();
    ctrl.sendInput({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: count,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFramePointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    // 只在按住时转发移动(拖动);hover 移动由浏览器的 mouseMoved 覆盖。
    if (e.buttons === 0) return;
    const rect = rectOf(e.currentTarget);
    const { x, y } = normalizedPoint(e.clientX, e.clientY, rect);
    ctrl.sendInput({
      type: 'mouseMove',
      x,
      y,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFramePointerUp = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const rect = rectOf(e.currentTarget);
    const { x, y } = normalizedPoint(e.clientX, e.clientY, rect);
    ctrl.sendInput({
      type: 'mouseUp',
      x,
      y,
      button: 'left',
      clickCount: clickRef.current?.count ?? 1,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFramePointerLeave = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    // 指针移出画面 → 让页面知道「没有悬停」了。
    const rect = rectOf(e.currentTarget);
    const { x, y } = normalizedPoint(e.clientX, e.clientY, rect);
    ctrl.sendInput({
      type: 'mouseMove',
      x,
      y,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFrameWheel = useCallback((e: React.WheelEvent<HTMLImageElement>) => {
    const rect = rectOf(e.currentTarget);
    const { x, y } = normalizedPoint(e.clientX, e.clientY, rect);
    ctrl.sendInput({
      type: 'mouseWheel',
      x,
      y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFrameKeyDown = useCallback((e: React.KeyboardEvent<HTMLImageElement>) => {
    // 吞掉按键:避免在页面里打字触发应用全局快捷键(⌘K / ⌘N 等)。
    e.preventDefault();
    e.stopPropagation();
    ctrl.sendInput({
      type: 'key',
      action: 'down',
      key: e.key,
      code: e.code,
      text: printableText(e.key),
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

  const onFrameKeyUp = useCallback((e: React.KeyboardEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    ctrl.sendInput({
      type: 'key',
      action: 'up',
      key: e.key,
      code: e.code,
      modifiers: browserModifiersFrom(e),
    });
  }, [ctrl]);

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
      onFramePointerDown={onFramePointerDown}
      onFramePointerMove={onFramePointerMove}
      onFramePointerUp={onFramePointerUp}
      onFramePointerLeave={onFramePointerLeave}
      onFrameWheel={onFrameWheel}
      onFrameKeyDown={onFrameKeyDown}
      onFrameKeyUp={onFrameKeyUp}
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
        frameLabel: t('harness.browser.frameLabel'),
      }}
    />
  );
}
