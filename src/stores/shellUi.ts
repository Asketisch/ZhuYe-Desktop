/**
 * src/stores/shellUi.ts —— harness 壳层 UI 状态。
 *
 * 新设计的壳层交互状态：侧栏 rail、右 dock 标签页、终端面板开关、
 * 任务中心、设置弹窗、单色模式。与 agentStore（会话/回合状态）解耦，
 * 只承载「窗口怎么摆」这一层。
 *
 * v1.x dock 标签页化（对齐 ZCode side pane）：右 dock 从五档单选改为
 * 标签页制 —— `dockTabs` / `dockActiveId` / `recentlyClosedTabs` /
 * `dockFullView`（完整视图）。关闭最后一个标签页即收起侧栏（同 ZCode
 * `closeSidePaneTab` 的收敛语义）；重新展开空侧栏自动补一个「新标签页」。
 * 持久化迁移：旧 `dockMode`（五档单选）读入即转换成单标签。
 *
 * 持久化：rail / dockTabs / dockActiveId / dockWide / termOpen / semantic /
 * dockWidth 写 localStorage（`zhuye-harness-ui`），主题仍由 appearance 体系管理。
 */
import { create } from 'zustand';

/** 右 dock 标签页种类。 */
export type DockTabKind =
  | 'inspector'
  | 'review'
  | 'files'
  | 'browser'
  | 'agents'
  | 'usage'
  | 'plan'
  | 'new-tab';

/** 右 dock 标签页。单例种类同 id（即 kind）；`files` 可多实例（uuid 后缀）。 */
export interface DockTab {
  id: string;
  kind: DockTabKind;
  /** 多实例标签的显示序号（文件 2 / 文件 3 …）。 */
  seq?: number;
}

/** 任务中心页签。 */
export type InboxTab = 'todo' | 'done';

/** 检查器（dock 内「检查器」标签页）的页签。 */
export type InspectorTab = 'overview' | 'files' | 'changes' | 'git';

/** 兼容旧五档单选的类型别名（`plan` 升为顶级标签后不再是 dock 档位）。 */
export type DockMode = Exclude<DockTabKind, 'plan'>;

interface ShellUiPersist {
  rail: boolean;
  /** v1.x 标签页制（替代旧 dockMode）。 */
  dockTabs: DockTab[];
  dockActiveId: string | null;
  dockWide: boolean;
  dockOpen: boolean;
  termOpen: boolean;
  semantic: 'on' | 'off';
  /** 用户拖拽出来的 dock 宽度（null = 未拖过，用默认宽度）。 */
  dockWidth: number | null;
}

const STORAGE_KEY = 'zhuye-harness-ui';

function isDockTabKind(value: unknown): value is DockTabKind {
  return (
    value === 'inspector' ||
    value === 'review' ||
    value === 'files' ||
    value === 'browser' ||
    value === 'agents' ||
    value === 'usage' ||
    value === 'plan' ||
    value === 'new-tab'
  );
}

/** 旧 dockMode 值 → 新标签页（`plan` 在旧模型里是 inspector 的子页签）。 */
function legacyModeToTab(mode: unknown): DockTab | null {
  const kind = mode === 'plan' ? 'inspector' : mode;
  return isDockTabKind(kind) && kind !== 'new-tab' ? { id: kind, kind } : null;
}

function sanitizeTabs(raw: unknown): DockTab[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tabs: DockTab[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, kind, seq } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !isDockTabKind(kind)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      kind,
      ...(typeof seq === 'number' ? { seq } : {}),
    });
  }
  return tabs;
}

function loadPersisted(): Partial<ShellUiPersist> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 迁移：旧模型只有 dockMode（五档单选）。
    const dockTabs = sanitizeTabs(parsed.dockTabs);
    if (dockTabs.length === 0 && parsed.dockMode != null) {
      const legacy = legacyModeToTab(parsed.dockMode);
      if (legacy) dockTabs.push(legacy);
    }
    return {
      rail: typeof parsed.rail === 'boolean' ? parsed.rail : undefined,
      dockTabs,
      dockActiveId:
        typeof parsed.dockActiveId === 'string' ? parsed.dockActiveId : undefined,
      dockWide: typeof parsed.dockWide === 'boolean' ? parsed.dockWide : undefined,
      dockOpen: typeof parsed.dockOpen === 'boolean' ? parsed.dockOpen : undefined,
      termOpen: typeof parsed.termOpen === 'boolean' ? parsed.termOpen : undefined,
      semantic:
        parsed.semantic === 'on' || parsed.semantic === 'off' ? parsed.semantic : undefined,
      dockWidth: typeof parsed.dockWidth === 'number' ? parsed.dockWidth : undefined,
    };
  } catch {
    return {};
  }
}

function savePersisted(state: ShellUiState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rail: state.rail,
        dockTabs: state.dockTabs,
        dockActiveId: state.dockActiveId,
        dockWide: state.dockWide,
        dockOpen: state.dockOpen,
        termOpen: state.termOpen,
        semantic: state.semantic,
        dockWidth: state.dockWidth,
      } satisfies ShellUiPersist),
    );
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}

/** 多实例种类：仅「文件」可多开（浏览器后端单实例，多开会抢帧流）。 */
function isMultiInstanceKind(kind: DockTabKind): boolean {
  return kind === 'files';
}

interface ShellUiState extends ShellUiPersist {
  /** 右 dock 开合（面板本体）。 */
  setDockOpen: (open: boolean) => void;
  toggleDockOpen: () => void;
  /** 当前 dock 标签页列表（有序）。 */
  dockTabs: DockTab[];
  /** 激活标签页 id；`null` = 无标签（侧栏即将收起）。 */
  dockActiveId: string | null;
  /** 最近关闭的标签页（上限 8；不含「新标签页」）。 */
  recentlyClosedTabs: DockTab[];
  /** 完整视图（dock 独占，对话列 0；同 ZCode ⇧⌘F）。非持久。 */
  dockFullView: boolean;
  /**
   * 打开（或激活）某类工具标签页。单例种类已有则激活；当前激活的是
   * 「新标签页」则原位替换（同 ZCode launcher 的 in-place 语义）。
   */
  openDockTab: (kind: Exclude<DockTabKind, 'new-tab'>) => void;
  /** 追加一个「新标签页」（启动器）。 */
  openNewDockTab: () => void;
  /** 激活标签页。 */
  activateDockTab: (id: string) => void;
  /** 关闭标签页；激活同索引邻居；关掉最后一个标签页即收起侧栏。 */
  closeDockTab: (id: string) => void;
  /** 关闭除指定标签页外的全部（至少保留一个）。 */
  closeOtherDockTabs: (id: string) => void;
  /** 关闭全部标签页（即收起侧栏）。 */
  closeAllDockTabs: () => void;
  /** 拖拽排序：把 from 位置的标签页移到 to 位置。 */
  moveDockTab: (from: number, to: number) => void;
  /** 重开最近关闭的标签页。 */
  reopenClosedDockTab: (id: string) => void;
  /** 完整视图切换。 */
  toggleDockFullView: () => void;
  /** 任务中心是否打开（非持久：每次启动收起）。 */
  inboxOpen: boolean;
  inboxTab: InboxTab;
  /** 检查器当前页签（非持久：面板重开回落到概览）。 */
  inspectorTab: InspectorTab;
  /** 设置弹窗是否打开。 */
  settingsOpen: boolean;
  /** 命令面板（⌘K）开关 —— 标题条按钮与快捷键共用同一状态。 */
  paletteOpen: boolean;
  /** 拖拽文件入窗的落区提示。 */
  dropHint: boolean;
  /** 未读产出（后台会话结束但未被打开过），键为会话 id。 */
  unread: Record<string, boolean>;
  markRead: (sessionId: string) => void;
  markUnread: (sessionId: string) => void;
  toggleRail: () => void;
  toggleDockWide: () => void;
  /**
   * 设置 dock 宽度（拖拽中高频调用）。
   *
   * 只改内存态：拖拽每帧都写 localStorage 会造成 IO 抖动，
   * 落盘由 {@link commitDockWidth} 在松手时做一次。
   */
  setDockWidth: (width: number | null) => void;
  /** 把当前 dock 宽度落盘（拖拽结束 / 键盘调整结束时调用）。 */
  commitDockWidth: () => void;
  setTermOpen: (open: boolean) => void;
  toggleTerm: () => void;
  openInbox: (tab?: InboxTab) => void;
  closeInbox: () => void;
  toggleInbox: () => void;
  setInboxTab: (tab: InboxTab) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setSemantic: (mode: 'on' | 'off') => void;
  toggleSemantic: () => void;
  setDropHint: (on: boolean) => void;
}

const persisted = loadPersisted();

/** 初始标签页列表：持久化缺失/为空时给「检查器」单标签（旧行为等价）。 */
function initialTabs(): DockTab[] {
  return persisted.dockTabs && persisted.dockTabs.length > 0
    ? persisted.dockTabs
    : [{ id: 'inspector', kind: 'inspector' }];
}

export const useShellUi = create<ShellUiState>((set, get) => ({
  rail: persisted.rail ?? false,
  dockTabs: initialTabs(),
  dockActiveId: persisted.dockActiveId ?? initialTabs()[0]?.id ?? null,
  dockWide: persisted.dockWide ?? false,
  dockOpen: persisted.dockOpen ?? false,
  termOpen: persisted.termOpen ?? false,
  semantic: persisted.semantic ?? 'on',
  dockWidth: persisted.dockWidth ?? null,
  recentlyClosedTabs: [],
  dockFullView: false,
  inboxOpen: false,
  inboxTab: 'todo',
  inspectorTab: 'overview',
  settingsOpen: false,
  paletteOpen: false,
  dropHint: false,
  unread: {},

  toggleRail: () =>
    set((s) => {
      const next = { ...s, rail: !s.rail };
      savePersisted(next);
      return { rail: next.rail };
    }),
  setDockOpen: (open) =>
    set(() => {
      // v1.x:显式展开空侧栏时补一个「新标签页」(同 ZCode ensureSidePaneTab)。
      const patch: Partial<ShellUiState> = { dockOpen: open };
      if (open && get().dockTabs.length === 0) {
        const tab: DockTab = { id: 'new-tab', kind: 'new-tab' };
        patch.dockTabs = [tab];
        patch.dockActiveId = tab.id;
      }
      const next = { ...get(), ...patch };
      savePersisted(next);
      return patch;
    }),
  toggleDockOpen: () => get().setDockOpen(!get().dockOpen),
  openDockTab: (kind) =>
    set(() => {
      const s = get();
      let tabs = s.dockTabs;
      let activeId: string;
      const existing = tabs.find((tab) => tab.kind === kind);
      if (existing) {
        activeId = existing.id;
      } else if (isMultiInstanceKind(kind)) {
        // 多实例：序号 = 同 kind 现有最大 seq + 1。
        const seq =
          tabs.reduce((max, tab) => (tab.kind === kind ? Math.max(max, tab.seq ?? 1) : max), 0) + 1;
        const tab: DockTab = { id: `${kind}:${seq}`, kind, ...(seq > 1 ? { seq } : {}) };
        // 当前激活的是「新标签页」→ 原位替换（同 ZCode commitOpenedSidePaneState）。
        const launcherIdx = tabs.findIndex((tab) => tab.kind === 'new-tab');
        tabs = launcherIdx >= 0
          ? [...tabs.slice(0, launcherIdx), tab, ...tabs.slice(launcherIdx + 1)]
          : [...tabs, tab];
        activeId = tab.id;
      } else {
        const tab: DockTab = { id: kind, kind };
        const launcherIdx = tabs.findIndex((tab) => tab.kind === 'new-tab');
        tabs = launcherIdx >= 0
          ? [...tabs.slice(0, launcherIdx), tab, ...tabs.slice(launcherIdx + 1)]
          : [...tabs, tab];
        activeId = tab.id;
      }
      const next = { ...get(), dockTabs: tabs, dockActiveId: activeId, dockOpen: true };
      savePersisted(next);
      return { dockTabs: next.dockTabs, dockActiveId: next.dockActiveId, dockOpen: true };
    }),
  openNewDockTab: () =>
    set(() => {
      const s = get();
      const tab: DockTab = { id: `new-tab:${Date.now().toString(36)}`, kind: 'new-tab' };
      const tabs = [...s.dockTabs, tab];
      const next = { ...s, dockTabs: tabs, dockActiveId: tab.id, dockOpen: true };
      savePersisted(next);
      return { dockTabs: next.dockTabs, dockActiveId: next.dockActiveId, dockOpen: true };
    }),
  activateDockTab: (id) =>
    set(() => {
      const next = { ...get(), dockActiveId: id };
      savePersisted(next);
      return { dockActiveId: id };
    }),
  closeDockTab: (id) =>
    set(() => {
      const s = get();
      const idx = s.dockTabs.findIndex((tab) => tab.id === id);
      if (idx === -1) return {};
      const closed = s.dockTabs[idx];
      const tabs = s.dockTabs.filter((tab) => tab.id !== id);
      const recentlyClosedTabs =
        closed.kind === 'new-tab'
          ? s.recentlyClosedTabs
          : [closed, ...s.recentlyClosedTabs].slice(0, 8);
      // 关掉最后一个标签页即收起侧栏（同 ZCode：关末标签必须收敛到收起态）。
      if (tabs.length === 0) {
        const next = { ...s, dockTabs: [], dockActiveId: null, dockOpen: false, recentlyClosedTabs };
        savePersisted(next);
        return { dockTabs: [], dockActiveId: null, dockOpen: false, recentlyClosedTabs };
      }
      const activeId =
        s.dockActiveId === id
          ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null)
          : s.dockActiveId;
      const next = { ...s, dockTabs: tabs, dockActiveId: activeId, recentlyClosedTabs };
      savePersisted(next);
      return { dockTabs: next.dockTabs, dockActiveId: next.dockActiveId, recentlyClosedTabs, dockOpen: true };
    }),
  closeOtherDockTabs: (id) =>
    set(() => {
      const s = get();
      const keep = s.dockTabs.filter((tab) => tab.id === id);
      if (keep.length === 0) return {};
      const closed = s.dockTabs.filter(
        (tab) => tab.id !== id && tab.kind !== 'new-tab',
      );
      const next = {
        ...s,
        dockTabs: keep,
        dockActiveId: id,
        recentlyClosedTabs: [...closed, ...s.recentlyClosedTabs].slice(0, 8),
      };
      savePersisted(next);
      return {
        dockTabs: next.dockTabs,
        dockActiveId: next.dockActiveId,
        recentlyClosedTabs: next.recentlyClosedTabs,
      };
    }),
  closeAllDockTabs: () =>
    set(() => {
      const s = get();
      const closed = s.dockTabs.filter((tab) => tab.kind !== 'new-tab');
      const next = {
        ...s,
        dockTabs: [],
        dockActiveId: null,
        dockOpen: false,
        recentlyClosedTabs: [...closed, ...s.recentlyClosedTabs].slice(0, 8),
      };
      savePersisted(next);
      return {
        dockTabs: [],
        dockActiveId: null,
        dockOpen: false,
        recentlyClosedTabs: next.recentlyClosedTabs,
      };
    }),
  moveDockTab: (from, to) =>
    set(() => {
      const s = get();
      if (from < 0 || to < 0 || from >= s.dockTabs.length || to >= s.dockTabs.length) return {};
      const moved = s.dockTabs[from];
      const remaining = [...s.dockTabs.slice(0, from), ...s.dockTabs.slice(from + 1)];
      const next = {
        ...s,
        dockTabs: [...remaining.slice(0, to), moved, ...remaining.slice(to)],
      };
      savePersisted(next);
      return { dockTabs: next.dockTabs };
    }),
  reopenClosedDockTab: (id) =>
    set(() => {
      const s = get();
      const tab = s.recentlyClosedTabs.find((tab) => tab.id === id);
      if (!tab) return {};
      const tabs = [...s.dockTabs, tab];
      const next = {
        ...s,
        dockTabs: tabs,
        dockActiveId: tab.id,
        dockOpen: true,
        recentlyClosedTabs: s.recentlyClosedTabs.filter((t) => t.id !== id),
      };
      savePersisted(next);
      return {
        dockTabs: next.dockTabs,
        dockActiveId: next.dockActiveId,
        dockOpen: true,
        recentlyClosedTabs: next.recentlyClosedTabs,
      };
    }),
  toggleDockFullView: () => set((s) => ({ dockFullView: !s.dockFullView })),
  toggleDockWide: () =>
    set((s) => {
      const next = { ...s, dockWide: !s.dockWide };
      savePersisted(next);
      return { dockWide: next.dockWide };
    }),
  setDockWidth: (width) => set(() => ({ dockWidth: width })),
  commitDockWidth: () => {
    const s = get();
    savePersisted(s);
  },
  setTermOpen: (open) =>
    set(() => {
      const next = { ...get(), termOpen: open };
      savePersisted(next);
      return { termOpen: open };
    }),
  toggleTerm: () => get().setTermOpen(!get().termOpen),
  openInbox: (tab) => set(() => ({ inboxOpen: true, ...(tab ? { inboxTab: tab } : {}) })),
  closeInbox: () => set({ inboxOpen: false }),
  toggleInbox: () => set((s) => ({ inboxOpen: !s.inboxOpen })),
  setInboxTab: (tab) => set({ inboxTab: tab }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setSemantic: (mode) =>
    set(() => {
      const next = { ...get(), semantic: mode };
      savePersisted(next);
      return { semantic: mode };
    }),
  toggleSemantic: () => get().setSemantic(get().semantic === 'on' ? 'off' : 'on'),
  setDropHint: (on) => set({ dropHint: on }),
  markRead: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.unread)) return s;
      const next = { ...s.unread };
      delete next[sessionId];
      return { unread: next };
    }),
  markUnread: (sessionId) =>
    set((s) => (s.unread[sessionId] ? s : { unread: { ...s.unread, [sessionId]: true } })),
}));
