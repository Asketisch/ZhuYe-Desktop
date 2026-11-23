import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import type { ShellSlots, ShellViewProps, ShellViewMode } from '@/contracts/shell';
import { useSessions, useActiveSession } from '@/logic/sessions/useSessions';
import { unpin, useSessionPins } from '@/logic/sessions/pins';
import { useAgentStore as useZAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { confirmDialog } from '@/logic/modals/confirm';
import { useI18n } from '@/utils/i18n';
import { useAgentNotifications, loadNotifyOptions } from '@/utils/notify';
import { zhuye_pick_workspace_folder, zhuye_set_workspace, zhuye_remove_workspace } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import { useThemeCycle } from '@/logic/shell/useThemeCycle';
import { useCommandPaletteShortcut } from '@/logic/shell/useCommandPaletteShortcut';
import { useMenuEvents } from '@/logic/shell/useMenuEvents';
import { usePaletteActions } from '@/logic/shell/usePaletteActions';
import { useCurrentWorkspace, CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/shell/useCurrentWorkspace';
import { useSessionBadges } from './useSessionBadges';
import { useHarnessShortcuts } from './useHarnessShortcuts';

/** 路由 → harness 视图形态（壳层样式与「更多」菜单高亮的依据）。 */
function pathnameToViewMode(pathname: string): ShellViewMode {
  if (pathname === '/' || pathname === '/home') return 'home';
  if (pathname.startsWith('/chat')) return 'conv';
  if (pathname.startsWith('/plan')) return 'plan';
  if (pathname.startsWith('/market')) return 'market';
  if (pathname.startsWith('/lanes')) return 'lanes';
  return 'page';
}

/** 绑定主壳的会话、工作区和全局动作。 */
export function ShellBinding({ view: View, slots, content }: { view: ComponentType<ShellViewProps>; slots: ShellSlots; content: ReactNode }) {
  const { currentWorkspace } = useCurrentWorkspace();
  // 全量列表:侧边栏按项目目录分组展示所有项目(而非只列当前工作区)。
  const sessions = useSessions();
  const pins = useSessionPins();
  const { activeId, setActiveId } = useActiveSession();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const router = useRouter();
  const pathname = router.state?.location?.pathname ?? '/';
  const zApprovals = useZAgentStore((st) => st.pendingApprovals);
  const zQuestions = useZAgentStore((st) => st.pendingQuestions);
  const zAskUsers = useZAgentStore((st) => st.pendingAskUser);
  const suppressInteraction = pathname.startsWith('/chat') && (zApprovals.length > 0 || zQuestions.length > 0 || zAskUsers.length > 0);
  const qc = useQueryClient();
  const { t, tp } = useI18n();
  const [sidebarOpen] = useState(true);
  // dock 开合已迁移到 shellUi store（标题条 / 快捷键 / dock 档位按钮共用）。
  const uiStoreOpen = useShellUi((s) => s.dockOpen);
  const inspectorOpen = uiStoreOpen;
  const setInspectorOpen = useShellUi((s) => s.setDockOpen);
  // 异步导航完成时只允许最后一次用户操作改变当前会话。
  const selectSeqRef = useRef(0);

  // 调色板所需的主题状态
  const { resolved, cycleTheme, setThemeMode } = useThemeCycle();

  // ⌘K / Ctrl+K 全局快捷键 + Esc 关闭
  const { paletteOpen, setPaletteOpen } = useCommandPaletteShortcut();

  // 原生菜单事件消费(menu-check-updates → 设置页,由挂载时自动检查完成触发)。
  useMenuEvents((to) => { void router.navigate({ to }); });

  /** 切换工作区并失效相关缓存(失效集与 WorkspacesView 的切换路径一致)。 */
  const switchWorkspace = async (path: string) => {
    await zhuye_set_workspace(path);
    void qc.invalidateQueries({ queryKey: ['agent-status'] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
    void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
  };

  const toastError = (message: string) => {
    useAgentStore.getState().pushToast({ kind: 'error', message });
  };

  /** 侧边栏「打开项目…」：系统目录选择器 → 切换工作区（复用 WorkspacesView 语义）。 */
  const handleOpenProject = async () => {
    const mySeq = ++selectSeqRef.current;
    let picked: string | null;
    try {
      picked = await zhuye_pick_workspace_folder();
    } catch (e) {
      toastError(t('workspaces.pickFailed', { msg: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (!picked || mySeq !== selectSeqRef.current) return;
    try {
      await switchWorkspace(picked);
      useAgentStore.getState().pushToast({
        kind: 'success',
        message: t('workspaces.setTo', { name: picked.split('/').filter(Boolean).pop() ?? picked }),
      });
    } catch (e) {
      toastError(t('workspaces.switchFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  // B13-B15 + D:agent 完成时 chime + 门控系统通知(失焦/时长/节流,
  // 点击跳回当前会话)+ 等待审批召回 + dock badge(设置开关)。
  useAgentNotifications(loadNotifyOptions(), {
    sessionId: activeId,
    onOpenSession: (id) => {
      if (id) void handleSelect(id);
    },
    title: t('app.name'),
    approvalBody: t('notify.approvalBody'),
    turnFinishedBody: t('notify.turnFinished'),
  });

  const handleSelect = async (id: string) => {
    const mySeq = ++selectSeqRef.current;
    // 工作区跟随会话:rebind 重建线程时烧入 override 工作区,
    // 跨项目点选先切到会话归属项目,保证续写/新消息用正确 cwd。
    const target = sessions.all.find((s) => s.session_id === id)?.workspace;
    // 即使缓存显示目标已激活，也要排在先前的切换之后，避免旧请求随后改掉目录。
    if (target) {
      try {
        await switchWorkspace(target);
      } catch (e: unknown) {
        // 原目录不可用时不能把该会话绑定到其他项目。
        if (mySeq === selectSeqRef.current) {
          toastError(t('toast.workspaceSwitchFailed', { msg: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
    }
    if (mySeq !== selectSeqRef.current) return;
    setActiveId(id);
  };

  // 新建会话:只导航到 `/chat` 新对话首页,不预分配 session id ——
  // 会话在首条消息发出时才创建落盘(useEnsureSession 链路),侧栏
  // 随首发后的列表刷新出现带真标题的条目,不再先闪一个 ID 空壳。
  // 会话级偏好(审批策略 / 提示词预设)留在 'new' 预创建键,首发转正。
  const handleNewChat = () => {
    // 已在新对话首页(无 id)时不重复导航。
    if (!activeId && pathname.startsWith('/chat')) return;
    void router.navigate({ to: '/chat' });
  };

  // fork 历史会话:复制 JSONL 生成子会话 → 直接切换过去(ChatView 挂载
  // 时 bind + replay 即得完整历史,可从 fork 点继续对话)。
  const handleForkSession = async (id: string, branch: string) => {
    const mySeq = ++selectSeqRef.current;
    const childId = await sessions.fork(id, branch);
    if (mySeq === selectSeqRef.current) setActiveId(childId);
    return childId;
  };

  // 在指定项目下新建会话:先切工作区(组头「+」入口),再回到新对话首页;
  // 会话本体同样等到首条消息发出才创建,workspace 由首条 submission 携带。
  const handleNewChatIn = (path: string) => {
    const mySeq = ++selectSeqRef.current;
    void switchWorkspace(path)
      .then(() => {
        if (mySeq === selectSeqRef.current) void router.navigate({ to: '/chat' });
      })
      .catch((e: unknown) => {
        toastError(t('toast.workspaceSwitchFailed', { msg: e instanceof Error ? e.message : String(e) }));
      });
  };

  const handleRemoveWorkspace = async (path: string) => {
    if (!await confirmDialog({ title: t('sidebar.group.remove'), message: t('sidebar.group.removeConfirm') })) return;
    try {
      await zhuye_remove_workspace(path);
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    }
  };

  // 删除 / 归档当前打开的会话后回到新对话视图，避免停留在已不存在的 session。
  // 删除/归档同时摘除置顶，避免置顶区悬挂引用。
  const handleDeleteSession = async (id: string) => {
    const mySeq = selectSeqRef.current;
    await sessions.remove(id);
    unpin(id);
    if (id === activeIdRef.current && mySeq === selectSeqRef.current) setActiveId(null);
  };
  const handleArchiveSession = async (id: string) => {
    const mySeq = selectSeqRef.current;
    await sessions.archive(id);
    unpin(id);
    if (id === activeIdRef.current && mySeq === selectSeqRef.current) setActiveId(null);
  };
  const handleUnarchiveSession = async (id: string) => {
    await sessions.unarchive(id);
  };

  // palette action handlers (集中到 hook)
  const { newSession, clearAllSessions, exportActive, exportActiveMarkdown, saveConfig, runSlash } = usePaletteActions({
    activeId,
    onNewChat: handleNewChat,
    onDeleteSession: handleDeleteSession,
    toasts: {
      newSession: t('toast.newSession'),
      noSessionsToClear: t('toast.noSessionsToClear'),
      clearedSessionsLabel: t('toast.clearAllTitle'),
      clearAllConfirm: (count: number) => t('toast.clearAllConfirm', { count }),
      deleteFailed: (msg) => t('toast.deleteFailed', { msg }),
      listSessionsFailed: (msg) => t('toast.listSessionsFailed', { msg }),
      clearedSessions: (count) => tp('toast.clearedSessions', count, { count }),
      noActiveToExport: t('toast.noActiveToExport'),
      exported: (path) => t('composer.exported', { path }),
      exportedNoPath: t('composer.exportedNoPath'),
      exportFailed: (msg) => t('toast.exportFailed', { msg }),
      exportedMarkdown: (path) => t('toast.exportedMarkdown', { path }),
      exportedMarkdownNoPath: t('toast.exportedMarkdownNoPath'),
      configReloaded: t('toast.configReloaded'),
      saveFailed: (msg) => t('toast.saveFailed', { msg }),
    },
  });

  const toasts = useAgentStore((st) => st.toasts);
  const dismissToast = useAgentStore((st) => st.dismissToast);

  // ===== harness 壳层数据 =====
  // 壳层 UI 状态（rail / dock / 终端面板 / 任务中心 / 单色模式）。
  const ui = useShellUi();
  // 单色模式挂到 <html data-semantic>，与主题 attribute 同层。
  useEffect(() => {
    document.documentElement.setAttribute('data-semantic', ui.semantic);
  }, [ui.semantic]);
  // 用户拖拽出的 dock 宽度投影为 CSS 变量；未拖过（null）时不写，
  // 由 harness.css 回落到各档位默认宽度。
  useEffect(() => {
    const root = document.documentElement;
    if (ui.dockWidth === null) root.style.removeProperty('--dock-user-width');
    else root.style.setProperty('--dock-user-width', `${ui.dockWidth}px`);
  }, [ui.dockWidth]);
  const viewMode = pathnameToViewMode(pathname);
  const workspaceLabel = useMemo(() => {
    if (!currentWorkspace) return t('harness.title.workspace');
    const segments = currentWorkspace.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? currentWorkspace;
  }, [currentWorkspace, t]);
  // 会话徽标：前台来自主 store，后台来自 backgroundSessions 投影。
  const sessionIds = useMemo(() => sessions.all.map((s) => s.session_id), [sessions.all]);
  const unreadRegistry = useMemo(() => ({
    unread: ui.unread,
    markRead: ui.markRead,
    markUnread: ui.markUnread,
  }), [ui.unread, ui.markRead, ui.markUnread]);
  const { badges, pendingCount, runningCount } = useSessionBadges(activeId, sessionIds, unreadRegistry);
  // 打开会话即清除未读产出标记。
  useEffect(() => {
    if (activeId) ui.markRead(activeId);
    // markRead 引用稳定（zustand action）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  // 「更多」菜单已移除（旧路由页入口待重新决策）；路由跳转仍由
  // navigate 供侧栏固定项使用。
  const harnessNavigate = useCallback((to: string) => { void router.navigate({ to }); }, [router]);
  const harnessData = useMemo(() => ({
    t,
    viewMode,
    workspaceLabel,
    navigate: harnessNavigate,
    pathname,
    openSettings: () => ui.setSettingsOpen(true),
    badges,
    pendingCount,
    runningCount,
  }), [t, viewMode, workspaceLabel, pathname, harnessNavigate, ui.setSettingsOpen, badges, pendingCount, runningCount]);

  // harness 快捷键（⌘\ / ⌘` / dock 档位 / 任务中心 / 单色 / 主题 …）。
  useHarnessShortcuts({
    onNewSession: handleNewChat,
    onNavigate: harnessNavigate,
  });

  return <View
    slots={slots} content={content} sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen}
    sidebarLabel={t('sidebar.sessions')} inspectorLabel={t('shell.inspector')}
    suppressInteraction={suppressInteraction} toasts={toasts} onDismissToast={dismissToast}
    onOpenUpdates={() => { void router.navigate({ to: '/usage' }); }}
    harness={{
      data: harnessData,
      rail: ui.rail,
      onToggleRail: ui.toggleRail,
      dockOpen: inspectorOpen,
      dockMode: ui.dockMode,
      dockWide: ui.dockWide,
      onSetDockMode: ui.setDockMode,
      onToggleDockWide: ui.toggleDockWide,
      onToggleDock: () => setInspectorOpen(!inspectorOpen),
      termOpen: ui.termOpen,
      onToggleTerm: ui.toggleTerm,
      inboxOpen: ui.inboxOpen,
      inboxTab: ui.inboxTab,
      onToggleInbox: ui.toggleInbox,
      onCloseInbox: ui.closeInbox,
      onOpenInbox: ui.openInbox,
      settingsOpen: ui.settingsOpen,
      onCloseSettings: () => ui.setSettingsOpen(false),
      semantic: ui.semantic,
      onToggleSemantic: ui.toggleSemantic,
    }}
    // v3 harness：标题条的 rail 开关接 shellUi.rail（旧 sidebarOpen 仅保留兼容字段）。
    titleBar={{ sidebarOpen: !ui.rail, inspectorOpen, onToggleSidebar: ui.toggleRail,
      onToggleInspector: () => setInspectorOpen(!inspectorOpen) }}
    sidebar={{ groups: sessions.groups, loading: sessions.loading, error: sessions.error, activeId,
      currentWorkspace, onSelect: handleSelect, onRefresh: sessions.refresh, onNewChat: handleNewChat,
      onNewChatIn: handleNewChatIn, onRemoveWorkspace: (path) => { void handleRemoveWorkspace(path); },
      onRename: sessions.rename, onDelete: handleDeleteSession, onExport: sessions.export,
      onFork: handleForkSession, onArchive: handleArchiveSession,
      onGenerateTitle: (id) => sessions.generateTitle(id, true), onOpenProject: () => { void handleOpenProject(); },
      pinnedIds: pins.pinnedIds, onTogglePin: pins.toggle, archived: sessions.archived, onUnarchive: handleUnarchiveSession,
      badges }}
    palette={{ open: paletteOpen, onClose: () => setPaletteOpen(false),
      navigate: (to) => { void router.navigate({ to }); }, cycleTheme, setTheme: setThemeMode, resolvedTheme: resolved,
      newSession, clearAllSessions: () => { void clearAllSessions(); }, exportActive: () => { void exportActive(); },
      exportActiveMarkdown: () => { void exportActiveMarkdown(); }, saveConfig: () => { void saveConfig(); }, runSlash }}
  />;
}
