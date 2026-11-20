/**
 * shellUi store 的 dock 宽度状态测试。
 *
 * 语义：dockWidth = null 表示「用户从未拖过」→ 各档位用各自默认宽度；
 * 拖拽中只改内存态（高频），松手时 commitDockWidth 落盘一次。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'zhuye-harness-ui';

async function freshStore() {
  vi.resetModules();
  const mod = await import('@/stores/shellUi');
  return mod.useShellUi;
}

describe('shellUi · dock 宽度', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认未拖过 —— dockWidth 为 null', async () => {
    const useShellUi = await freshStore();
    expect(useShellUi.getState().dockWidth).toBeNull();
  });

  it('setDockWidth 只改内存态，不写 localStorage', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().setDockWidth(420);
    expect(useShellUi.getState().dockWidth).toBe(420);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('commitDockWidth 落盘一次，重载后恢复', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().setDockWidth(420);
    useShellUi.getState().commitDockWidth();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).dockWidth).toBe(420);

    // 模拟重开应用：重新加载模块 → 从 localStorage 恢复。
    const reloaded = await freshStore();
    expect(reloaded.getState().dockWidth).toBe(420);
  });

  it('未拖过时不落盘 dockWidth 键（保持 null 语义）', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().commitDockWidth();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).dockWidth).toBeNull();
  });
});
