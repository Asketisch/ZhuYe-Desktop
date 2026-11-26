/**
 * DockResizer —— 右 dock 左缘分隔条的拖拽 / 键盘行为测试。
 *
 * 覆盖：向左拖 → 变宽（分隔条左移即面板变宽）、宽度钳制、键盘 ←/→
 * 调整、无障碍属性（role=separator / aria-valuenow）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { DockResizer, DOCK_WIDTH_MIN, clampDockWidth, maxDockWidth } from '@/features/harness/shell/DockResizer';
import { useShellUi } from '@/stores/shellUi';

/** jsdom 不做布局 —— 用固定矩形替代测量结果。 */
const RECT = { left: 1000, top: 0, width: 400, height: 800 };

/** 拖拽走 rAF 节流 —— 等一帧让状态落地。 */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
}

function renderResizer() {
  return render(
    <div data-testid="dock-host">
      <DockResizer />
    </div>,
  );
}

describe('DockResizer', () => {
  beforeEach(() => {
    localStorage.clear();
    useShellUi.setState({ dockWidth: null });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.height,
      x: RECT.left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染为可聚焦的竖向分隔条', () => {
    renderResizer();
    const el = screen.getByTestId('harness-dock-resizer');
    expect(el.getAttribute('role')).toBe('separator');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-valuemin')).toBe(String(DOCK_WIDTH_MIN));
  });

  it('向左拖动 → dock 变宽；向右拖动 → 变窄', async () => {
    renderResizer();
    const el = screen.getByTestId('harness-dock-resizer');
    const startWidth = RECT.width;

    fireEvent.pointerDown(el, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 900, pointerId: 1 });
    await flushFrame();
    expect(useShellUi.getState().dockWidth).toBe(startWidth + 100);

    fireEvent.pointerUp(el, { clientX: 900, pointerId: 1 });
    fireEvent.pointerDown(el, { button: 0, clientX: 900, pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 950, pointerId: 2 });
    await flushFrame();
    expect(useShellUi.getState().dockWidth).toBe(startWidth + 50);
  });

  it('宽度钳制在 [下限, 上限] 之间', async () => {
    renderResizer();
    const el = screen.getByTestId('harness-dock-resizer');

    // 往左拖很远 → 撞上限
    fireEvent.pointerDown(el, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 0, pointerId: 1 });
    await flushFrame();
    expect(useShellUi.getState().dockWidth).toBe(maxDockWidth());

    // 往右拖很远 → 撞下限
    fireEvent.pointerDown(el, { button: 0, clientX: 1000, pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 3000, pointerId: 2 });
    await flushFrame();
    expect(useShellUi.getState().dockWidth).toBe(DOCK_WIDTH_MIN);
  });

  it('键盘 ←/→ 调整宽度，Home/End 到边界', () => {
    renderResizer();
    const el = screen.getByTestId('harness-dock-resizer');

    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(useShellUi.getState().dockWidth).toBe(RECT.width + 16);

    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(useShellUi.getState().dockWidth).toBe(RECT.width);

    fireEvent.keyDown(el, { key: 'End' });
    expect(useShellUi.getState().dockWidth).toBe(maxDockWidth());

    fireEvent.keyDown(el, { key: 'Home' });
    expect(useShellUi.getState().dockWidth).toBe(DOCK_WIDTH_MIN);
  });

  it('键盘调整立即落盘', () => {
    renderResizer();
    const el = screen.getByTestId('harness-dock-resizer');
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    const raw = localStorage.getItem('zhuye-harness-ui');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).dockWidth).toBe(RECT.width + 16);
  });

  it('clampDockWidth 落在合法区间', () => {
    expect(clampDockWidth(10)).toBe(DOCK_WIDTH_MIN);
    expect(clampDockWidth(99999)).toBe(maxDockWidth());
    expect(clampDockWidth(400)).toBe(400);
  });
});
