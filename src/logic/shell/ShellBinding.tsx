import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import type { ShellSlots, ShellViewProps } from '@/contracts/shell';
import { useSessions, useActiveSession } from '@/logic/sessions/useSessions';
import { unpin, useSessionPins } from '@/logic/sessions/pins';
import { useAgentStore as useZAgentStore } from '@/stores/agentStore';
import { confirmDialog } from '@/logic/modals/confirm';
import { useI18n } from '@/utils/i18n';
import { useAgentNotifications, loadNotifyOptions } from '@/utils/notify';
import { reflect_create_session, reflect_pick_workspace_folder, reflect_set_workspace, reflect_remove_workspace } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import { useThemeCycle } from '@/logic/shell/useThemeCycle';
import { useCommandPaletteShortcut } from '@/logic/shell/useCommandPaletteShortcut';
import { usePaletteActions } from '@/logic/shell/usePaletteActions';
import { useCurrentWorkspace, CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/shell/useCurrentWorkspace';

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // 异步导航完成时只允许最后一次用户操作改变当前会话。
  const selectSeqRef = useRef(0);

  // 调色板所需的主题状态
  const { resolved, cycleTheme, setThemeMode } = useThemeCycle();

  // ⌘K / Ctrl+K 全局快捷键 + Esc 关闭
  const { paletteOpen, setPaletteOpen } = useCommandPaletteShortcut();

  /** 切换工作区并失效相关缓存(失效集与 WorkspacesView 的切换路径一致)。 */
  const switchWorkspace = async (path: string) => {
    await reflect_set_workspace(path);
    void qc.invalidateQueries({ queryKey: ['agent-status'] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
    void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
  };

  const toastError = (message: string) => {
    useAgentStore.getState().pushToast({ kind: 'error', message });
  };

  const showNewSession = (id: string, workspace: string | null) => {
    qc.setQueryData<import('@/utils/commands').ReflectSessionInfo[]>(
      ['sessions', { workspace: null }],
      (previous = []) => [{ session_id: id, model: '', started_at: new Date().toISOString(), message_count: 0, workspace }, ...previous.filter((s) => s.session_id !== id)],
    );
  };

  /** 侧边栏「打开项目…」：系统目录选择器 → 切换工作区（复用 WorkspacesView 语义）。 */
  const handleOpenProject = async () => {
    const mySeq = ++selectSeqRef.current;
    let picked: string | null;
    try {
      picked = await reflect_pick_workspace_folder();
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

  // 新建会话:后端预分配 session id → navigate 到 /chat/<id>。
  // workspace 归属不在这里落盘,由首条 submission 携带 `workspace`
  // 触发后端写 `SessionMeta`(见 docs/protocol-bridge.md §2)。
  const handleNewChat = () => {
    const mySeq = ++selectSeqRef.current;
    const pushToast = useAgentStore.getState().pushToast;
    void reflect_create_session()
      .then((id) => {
        if (mySeq === selectSeqRef.current) {
          showNewSession(id, currentWorkspace);
          setActiveId(id);
        }
      })
      .catch((e: unknown) => {
        pushToast({
          kind: 'error',
          message: t('toast.newSessionFailed', { msg: e instanceof Error ? e.message : String(e) }),
        });
      });
  };

  // fork 历史会话:复制 JSONL 生成子会话 → 直接切换过去(ChatView 挂载
  // 时 bind + replay 即得完整历史,可从 fork 点继续对话)。
  const handleForkSession = async (id: string, branch: string) => {
    const mySeq = ++selectSeqRef.current;
    const childId = await sessions.fork(id, branch);
    if (mySeq === selectSeqRef.current) setActiveId(childId);
    return childId;
  };

  // 在指定项目下新建会话:先切工作区(组头「+」入口),再预分配 id 并导航。
  const handleNewChatIn = (path: string) => {
    const mySeq = ++selectSeqRef.current;
    void switchWorkspace(path)
      .then(() => mySeq === selectSeqRef.current ? reflect_create_session() : null)
      .then((id) => {
        if (id && mySeq === selectSeqRef.current) {
          showNewSession(id, path);
          setActiveId(id);
        }
      })
      .catch((e: unknown) => {
        toastError(t('toast.newSessionFailed', { msg: e instanceof Error ? e.message : String(e) }));
      });
  };

  const handleRemoveWorkspace = async (path: string) => {
    if (!await confirmDialog({ title: t('sidebar.group.remove'), message: t('sidebar.group.removeConfirm') })) return;
    try {
      await reflect_remove_workspace(path);
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
  return <View
    slots={slots} content={content} sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen}
    sidebarLabel={t('sidebar.sessions')} inspectorLabel={t('shell.inspector')}
    suppressInteraction={suppressInteraction} toasts={toasts} onDismissToast={dismissToast}
    onOpenUpdates={() => { void router.navigate({ to: '/usage' }); }}
    titleBar={{ sidebarOpen, inspectorOpen, onToggleSidebar: () => setSidebarOpen((value) => !value),
      onToggleInspector: () => setInspectorOpen((value) => !value) }}
    sidebar={{ groups: sessions.groups, loading: sessions.loading, error: sessions.error, activeId,
      currentWorkspace, onSelect: handleSelect, onRefresh: sessions.refresh, onNewChat: handleNewChat,
      onNewChatIn: handleNewChatIn, onRemoveWorkspace: (path) => { void handleRemoveWorkspace(path); },
      onRename: sessions.rename, onDelete: handleDeleteSession, onExport: sessions.export,
      onFork: handleForkSession, onArchive: handleArchiveSession,
      onGenerateTitle: (id) => sessions.generateTitle(id, true), onOpenProject: () => { void handleOpenProject(); },
      pinnedIds: pins.pinnedIds, onTogglePin: pins.toggle, archived: sessions.archived, onUnarchive: handleUnarchiveSession }}
    palette={{ open: paletteOpen, onClose: () => setPaletteOpen(false),
      navigate: (to) => { void router.navigate({ to }); }, cycleTheme, setTheme: setThemeMode, resolvedTheme: resolved,
      newSession, clearAllSessions: () => { void clearAllSessions(); }, exportActive: () => { void exportActive(); },
      exportActiveMarkdown: () => { void exportActiveMarkdown(); }, saveConfig: () => { void saveConfig(); }, runSlash }}
  />;
}
