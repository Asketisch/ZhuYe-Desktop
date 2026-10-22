/**
 * AppShell —— IDE 式三栏布局（贯通顶栏版）。
 *
 * 结构（从上到下）：
 *   ┌────────────────────────────────────────────────────┐
 *   │ TitleBar (贯通全宽，红绿灯 + drag region)            │  ← .shell[0]
 *   ├──────┬────────────┬──────────────┬─────────────────┤
 *   │Activ │ Sidebar    │ Main content │ Inspector       │  ← .body
 *   │ Bar  │ (sessions) │ (Outlet)     │                 │
 *   ├──────┴────────────┴──────────────┴─────────────────┤
 *   │ StatusBar                                          │  ← .shell[2]
 *   └────────────────────────────────────────────────────┘
 *
 * 关键决策：TitleBar 是 .shell 的第一个子元素（**与 ActivityBar 同级，而非嵌在 .main 内**），
 * 这样它横跨整个窗口宽度。macOS 红绿灯按钮（titleBarStyle: "Overlay"）嵌在顶栏左侧
 * （由 TitleBar 的 `--traffic-light-gutter` 左 padding 让位），与常见 IDE 顶栏范式一致。
 *
 * **TanStack Router v1 根路由契约**：rootRoute 的 component 必须渲染 `<Outlet />`
 * 才能把匹配到的子路由（HomeView / ChatView / SettingsView / …）挂到 DOM。
 *
 * 阶段 A2 历史：
 *   - Sidebar onSelect 同步 URL（navigate 到 /chat/$sessionId）+ 本地高亮。
 *   - onNewChat 导航到 /chat（新对话视图）。
 *
 * 结构化重构（A11+）：
 *   - 主题切换状态机 → `./hooks/useThemeCycle`。
 *   - 全局快捷键（⌘K / Esc）→ `./hooks/useCommandPaletteShortcut`。
 *   - 命令面板动作（newSession / clearAllSessions / exportActive / exportActiveMarkdown / saveConfig / runSlash）
 *     → `./hooks/usePaletteActions`。
 *   - AppShell 本身只负责布局与 DOM 拼装。
 */
import { useRef, useState } from 'react';
import { useRouter, Outlet } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityBar } from './ActivityBar';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { Inspector } from './Inspector';
import { Sidebar } from '@/features/sessions/components/Sidebar';
import { useSessions, useActiveSession } from '@/features/sessions/hooks/useSessions';
import { unpin, useSessionPins } from '@/features/sessions/utils/pins';
import { ModalStack } from '@/features/modals';
import { ConfirmDialogHost } from '@/features/modals/ConfirmDialog';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { Toast } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentNotifications, loadNotifyOptions } from '@/utils/notify';
import {
  reflect_create_session,
  reflect_pick_workspace_folder,
  reflect_set_workspace,
} from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import { useThemeCycle } from './hooks/useThemeCycle';
import { useCommandPaletteShortcut } from './hooks/useCommandPaletteShortcut';
import { usePaletteActions } from './hooks/usePaletteActions';
import { useCurrentWorkspace, CURRENT_WORKSPACE_QUERY_KEY } from './hooks/useCurrentWorkspace';
import { ViewErrorBoundary } from './ErrorBoundary';
import s from './AppShell.module.css';

/**
 * ToastHost —— 渲染 useAgentStore.toasts 全局队列。
 * pushToast 的所有调用方（git/tasks/设置/导出失败提示等）此前只入队
 * 从未渲染，操作反馈全部静默丢失；这里统一挂在壳层。
 */
function ToastHost() {
  const toasts = useAgentStore((st) => st.toasts);
  const dismissToast = useAgentStore((st) => st.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className={s.toastHost}>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          // store 侧用 'warn'，设计系统侧是 'warning'。
          kind={t.kind === 'warn' ? 'warning' : t.kind}
          message={t.message}
          durationMs={t.ttlMs}
          onDismiss={() => dismissToast(t.id)}
        />
      ))}
    </div>
  );
}

export function AppShell() {
  const { currentWorkspace } = useCurrentWorkspace();
  // 全量列表:侧边栏按项目目录分组展示所有项目(而非只列当前工作区)。
  const sessions = useSessions();
  const pins = useSessionPins();
  const { activeId, setActiveId } = useActiveSession();
  const router = useRouter();
  const qc = useQueryClient();
  const { t, tp } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);

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

  /** 侧边栏「打开项目…」：系统目录选择器 → 切换工作区（复用 WorkspacesView 语义）。 */
  const handleOpenProject = async () => {
    let picked: string | null;
    try {
      picked = await reflect_pick_workspace_folder();
    } catch (e) {
      toastError(t('workspaces.pickFailed', { msg: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (!picked) return;
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

  // 选择令牌:快速连点两个会话时,先点的跨项目 switchWorkspace 完成后
  // 不得覆盖后一次点击的 activeId。
  const selectSeqRef = useRef(0);

  const handleSelect = async (id: string) => {
    const mySeq = ++selectSeqRef.current;
    // 工作区跟随会话:rebind 重建线程时烧入 override 工作区,
    // 跨项目点选先切到会话归属项目,保证续写/新消息用正确 cwd。
    const target = sessions.all.find((s) => s.session_id === id)?.workspace;
    if (target && target !== currentWorkspace) {
      try {
        await switchWorkspace(target);
      } catch (e: unknown) {
        // 目录可能已被删除/移走;会话仍打开,仅提示切换失败。
        toastError(t('toast.workspaceSwitchFailed', { msg: e instanceof Error ? e.message : String(e) }));
      }
    }
    if (mySeq !== selectSeqRef.current) return;
    setActiveId(id);
  };

  // 新建会话:后端预分配 session id → navigate 到 /chat/<id>。
  // workspace 归属不在这里落盘,由首条 submission 携带 `workspace`
  // 触发后端写 `SessionMeta`(见 PROTOCOL_BRIDGE §2)。
  const handleNewChat = () => {
    const pushToast = useAgentStore.getState().pushToast;
    void reflect_create_session()
      .then((id) => {
        setActiveId(id);
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
    const childId = await sessions.fork(id, branch);
    setActiveId(childId);
    return childId;
  };

  // 在指定项目下新建会话:先切工作区(组头「+」入口),再预分配 id 并导航。
  const handleNewChatIn = (path: string) => {
    void switchWorkspace(path)
      .then(() => reflect_create_session())
      .then((id) => {
        setActiveId(id);
      })
      .catch((e: unknown) => {
        toastError(t('toast.newSessionFailed', { msg: e instanceof Error ? e.message : String(e) }));
      });
  };

  // 删除 / 归档当前打开的会话后回到新对话视图，避免停留在已不存在的 session。
  // 删除/归档同时摘除置顶，避免置顶区悬挂引用。
  const handleDeleteSession = async (id: string) => {
    await sessions.remove(id);
    unpin(id);
    if (id === activeId) setActiveId(null);
  };
  const handleArchiveSession = async (id: string) => {
    await sessions.archive(id);
    unpin(id);
    if (id === activeId) setActiveId(null);
  };
  const handleUnarchiveSession = async (id: string) => {
    await sessions.unarchive(id);
  };

  // palette action handlers (集中到 hook)
  const { newSession, clearAllSessions, exportActive, exportActiveMarkdown, saveConfig, runSlash } = usePaletteActions({
    activeId,
    onNewChat: handleNewChat,
    toasts: {
      newSession: t('toast.newSession'),
      noSessionsToClear: t('toast.noSessionsToClear'),
      clearedSessionsLabel: t('toast.clearAllTitle'),
      clearAllConfirm: (count: number) => t('toast.clearAllConfirm', { count }),
      deleteFailed: (msg) => t('toast.deleteFailed', { msg }),
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

  return (
    <div className={s.shell}>
      {/* 贯通全宽顶栏：红绿灯按钮（macOS Overlay）嵌在里面。
       * 必须是 .shell 的第一个子元素，让 .body（ActivityBar + Sidebar + Main + Inspector）
       * 全部从顶栏下方开始 —— 「一条贯通全宽的深色顶栏」范式。
       */}
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
      />
      <div className={s.body}>
        <ActivityBar />
        {sidebarOpen && (
          <aside className={s.sidebar} aria-label={t('sidebar.sessions')} data-testid="shell-sidebar">
              <Sidebar
              groups={sessions.groups}
              loading={sessions.loading}
              error={sessions.error}
              activeId={activeId}
              currentWorkspace={currentWorkspace}
              onSelect={handleSelect}
              onRefresh={sessions.refresh}
              onNewChat={handleNewChat}
              onNewChatIn={handleNewChatIn}
              onRename={sessions.rename}
              onDelete={handleDeleteSession}
              onExport={sessions.export}
              onFork={handleForkSession}
              onArchive={handleArchiveSession}
              onGenerateTitle={(id) => sessions.generateTitle(id, true)}
              onOpenProject={() => void handleOpenProject()}
              pinnedIds={pins.pinnedIds}
              onTogglePin={pins.toggle}
              archived={sessions.archived}
              onUnarchive={handleUnarchiveSession}
            />
          </aside>
        )}
        <main className={s.main}>
          <div className={s.content}>
            {/* TanStack Router v1：渲染匹配到的子路由。
                ErrorBoundary 把视图级渲染错误限制在主内容区 ——
                侧栏/状态栏保持可用,不再整树白屏。 */}
            <ViewErrorBoundary>
              <Outlet />
            </ViewErrorBoundary>
          </div>
        </main>
        {inspectorOpen && (
          <aside className={s.inspector} aria-label={t('shell.inspector')} data-testid="shell-inspector">
            <Inspector />
          </aside>
        )}
      </div>
      <StatusBar />
      <ToastHost />
      <ModalStack />
      <ConfirmDialogHost />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigate={(to) => void router.navigate({ to })}
        cycleTheme={cycleTheme}
        setTheme={setThemeMode}
        resolvedTheme={resolved}
        newSession={newSession}
        clearAllSessions={() => void clearAllSessions()}
        exportActive={() => void exportActive()}
        exportActiveMarkdown={() => void exportActiveMarkdown()}
        saveConfig={() => void saveConfig()}
        runSlash={runSlash}
      />
    </div>
  );
}
