/**
 * src/stores/shellUi.ts —— harness 壳层 UI 状态。
 *
 * 新设计的壳层交互状态：侧栏 rail、右 dock 档位与宽度、终端面板开关、
 * 任务中心、设置弹窗、单色模式。与 agentStore（会话/回合状态）解耦，
 * 只承载「窗口怎么摆」这一层。
 *
 * 持久化：rail / dockMode / dockWide / termOpen / semantic 写
 * localStorage（`zhuye-harness-ui`），主题仍由 appearance 体系管理。
 */
import { create } from 'zustand';

/** 右侧 dock 的五个档位（对应设计稿 dock-mode 按钮）。 */
export type DockMode = 'inspector' | 'browser' | 'files' | 'agents' | 'usage';

/** 任务中心页签。 */
export type InboxTab = 'todo' | 'done';

/** 检查器（右 dock inspector 档）的页签。 */
export type InspectorTab = 'overview' | 'files' | 'changes' | 'plan' | 'git';

interface ShellUiPersist {
  rail: boolean;
  dockMode: DockMode;
  dockWide: boolean;
  dockOpen: boolean;
  termOpen: boolean;
  semantic: 'on' | 'off';
  /** 用户拖拽出来的 dock 宽度（null = 未拖过，用各档位默认宽度）。 */
  dockWidth: number | null;
}

const STORAGE_KEY = 'zhuye-harness-ui';

function loadPersisted(): Partial<ShellUiPersist> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ShellUiPersist>) : {};
  } catch {
    return {};
  }
}

function savePersisted(state: ShellUiPersist): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rail: state.rail,
      dockMode: state.dockMode,
      dockWide: state.dockWide,
      dockOpen: state.dockOpen,
      termOpen: state.termOpen,
      semantic: state.semantic,
      dockWidth: state.dockWidth,
    } satisfies ShellUiPersist));
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}

interface ShellUiState extends ShellUiPersist {
  /** 右 dock 开合（检查器面板本体）。 */
  setDockOpen: (open: boolean) => void;
  toggleDockOpen: () => void;
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
  setDockMode: (mode: DockMode) => void;
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

export const useShellUi = create<ShellUiState>((set, get) => ({
  rail: persisted.rail ?? false,
  dockMode: persisted.dockMode ?? 'inspector',
  dockWide: persisted.dockWide ?? false,
  dockOpen: persisted.dockOpen ?? false,
  termOpen: persisted.termOpen ?? false,
  semantic: persisted.semantic ?? 'on',
  dockWidth: persisted.dockWidth ?? null,
  inboxOpen: false,
  inboxTab: 'todo',
  inspectorTab: 'overview',
  settingsOpen: false,
  paletteOpen: false,
  dropHint: false,
  unread: {},

  toggleRail: () => set((s) => {
    const next = { ...s, rail: !s.rail };
    savePersisted(next);
    return { rail: next.rail };
  }),
  setDockOpen: (open) => set(() => {
    const next = { ...get(), dockOpen: open };
    savePersisted(next);
    return { dockOpen: open };
  }),
  toggleDockOpen: () => get().setDockOpen(!get().dockOpen),
  setDockMode: (mode) => set(() => {
    const next = { ...get(), dockMode: mode };
    savePersisted(next);
    return { dockMode: mode };
  }),
  toggleDockWide: () => set((s) => {
    const next = { ...s, dockWide: !s.dockWide };
    savePersisted(next);
    return { dockWide: next.dockWide };
  }),
  setDockWidth: (width) => set(() => ({ dockWidth: width })),
  commitDockWidth: () => {
    const s = get();
    savePersisted({
      rail: s.rail,
      dockMode: s.dockMode,
      dockWide: s.dockWide,
      dockOpen: s.dockOpen,
      termOpen: s.termOpen,
      semantic: s.semantic,
      dockWidth: s.dockWidth,
    });
  },
  setTermOpen: (open) => set(() => {
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
  setSemantic: (mode) => set(() => {
    const next = { ...get(), semantic: mode };
    savePersisted(next);
    return { semantic: mode };
  }),
  toggleSemantic: () => get().setSemantic(get().semantic === 'on' ? 'off' : 'on'),
  setDropHint: (on) => set({ dropHint: on }),
  markRead: (sessionId) => set((s) => {
    if (!(sessionId in s.unread)) return s;
    const next = { ...s.unread };
    delete next[sessionId];
    return { unread: next };
  }),
  markUnread: (sessionId) => set((s) => (
    s.unread[sessionId] ? s : { unread: { ...s.unread, [sessionId]: true } }
  )),
}));
