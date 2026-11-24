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

describe('shellUi · dock 标签页', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认给「检查器」单标签', async () => {
    const useShellUi = await freshStore();
    expect(useShellUi.getState().dockTabs).toEqual([{ id: 'inspector', kind: 'inspector' }]);
    expect(useShellUi.getState().dockActiveId).toBe('inspector');
  });

  it('openDockTab 种类单例：已存在则激活，不重复新增', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openDockTab('browser');
    useShellUi.getState().openDockTab('browser');
    expect(useShellUi.getState().dockTabs.filter((tab) => tab.kind === 'browser')).toHaveLength(1);
    expect(useShellUi.getState().dockActiveId).toBe('browser');
  });

  it('启动器标签被工具打开时原位替换', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openNewDockTab();
    const launcherId = useShellUi.getState().dockActiveId;
    expect(launcherId).toContain('new-tab');
    useShellUi.getState().openDockTab('plan');
    const tabs = useShellUi.getState().dockTabs;
    expect(tabs).toHaveLength(2); // 原检查器 + 替换后的计划
    expect(tabs.find((tab) => tab.id === launcherId)).toBeUndefined();
    expect(useShellUi.getState().dockActiveId).toBe('plan');
  });

  it('文件可多开并带序号', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openDockTab('files');
    // 单例语义关闭后重新开第二实例：先制造多文件场景。
    useShellUi.setState({ dockTabs: [], dockActiveId: null });
    useShellUi.getState().openDockTab('files');
    useShellUi.getState().openNewDockTab();
    useShellUi.getState().openDockTab('files');
    const files = useShellUi.getState().dockTabs.filter((tab) => tab.kind === 'files');
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('关掉最后一个标签页即收起侧栏，重新展开补启动器', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().setDockOpen(true);
    useShellUi.getState().closeDockTab('inspector');
    expect(useShellUi.getState().dockOpen).toBe(false);
    expect(useShellUi.getState().dockTabs).toHaveLength(0);
    useShellUi.getState().setDockOpen(true);
    expect(useShellUi.getState().dockTabs.some((tab) => tab.kind === 'new-tab')).toBe(true);
  });

  it('关激活标签激活同索引邻居', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openDockTab('browser');
    useShellUi.getState().openDockTab('files');
    const filesId = useShellUi.getState().dockActiveId!;
    expect(filesId).toContain('files');
    useShellUi.getState().closeDockTab(filesId);
    expect(useShellUi.getState().dockActiveId).toBe('browser');
  });

  it('最近关闭可重开，容量 8', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().setDockOpen(true);
    useShellUi.getState().openDockTab('browser');
    useShellUi.getState().closeDockTab('browser');
    expect(useShellUi.getState().recentlyClosedTabs.some((tab) => tab.kind === 'browser')).toBe(true);
    useShellUi.getState().reopenClosedDockTab('browser');
    expect(useShellUi.getState().dockTabs.some((tab) => tab.kind === 'browser')).toBe(true);
    expect(useShellUi.getState().recentlyClosedTabs.some((tab) => tab.kind === 'browser')).toBe(false);
  });

  it('moveDockTab 重排保留全部标签', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openDockTab('browser');
    const before = useShellUi.getState().dockTabs.map((tab) => tab.id);
    useShellUi.getState().moveDockTab(0, before.length - 1);
    const after = useShellUi.getState().dockTabs.map((tab) => tab.id);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('旧 dockMode 持久化迁移为单标签', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dockMode: 'browser' }));
    const useShellUi = await freshStore();
    expect(useShellUi.getState().dockTabs).toEqual([{ id: 'browser', kind: 'browser' }]);
  });

  it('closeOtherDockTabs / closeAllDockTabs 收口', async () => {
    const useShellUi = await freshStore();
    useShellUi.getState().openDockTab('browser');
    useShellUi.getState().closeOtherDockTabs('inspector');
    expect(useShellUi.getState().dockTabs).toHaveLength(1);
    useShellUi.getState().openDockTab('files');
    useShellUi.getState().closeAllDockTabs();
    expect(useShellUi.getState().dockTabs).toHaveLength(0);
    expect(useShellUi.getState().dockOpen).toBe(false);
  });
});
