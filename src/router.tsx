/**
 * TanStack Router v1 —— 烛夜 ZhuYe 路由树。
 *
 * 阶段 2：root component 从 AppLayout 切到 IDE 式 AppShell。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, RootRoute, Router } from '@tanstack/react-router';
import React, { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useBackgroundSessions } from '@/stores/backgroundSessions';
import { useEditorStore } from '@/stores/editorStore';
import { ModalStack } from '@/features/harness/modals';
import { AppShell } from '@/features/harness/shell/AppShell';
import { I18nProvider } from '@/utils/i18n';

// ====== 路由组件 ======
import { ChatView } from '@/features/conversation/messages/ChatView';
import { SettingsView } from '@/features/harness/settings/SettingsView';
import { HomeView } from '@/features/conversation/home/HomeView';
import { ThreadsView } from '@/features/conversation/threads/ThreadsView';
import { ModelsView } from '@/features/knowledge/models/ModelsView';
import { FilesView } from '@/features/workbench/files/FilesView';
import { GitView } from '@/features/workbench/git/GitView';
import { PullRequestsView } from '@/features/workbench/git/PullRequestsView';
import { SkillsView } from '@/features/knowledge/skills/SkillsView';
import { WorkspacesView } from '@/features/pages/workspaces/WorkspacesView';
import { PlanView } from '@/features/orchestration/plan/PlanView';
import { PromptsView } from '@/features/knowledge/prompts/PromptsView';
import { NotificationsView } from '@/features/telemetry/notifications/NotificationsView';
import { TerminalView } from '@/features/workbench/terminal/TerminalView';
import { AboutView } from '@/features/pages/about/AboutView';
import { AppsView } from '@/features/knowledge/apps/AppsView';
import { HtmlPreviewView } from '@/features/workbench/preview/HtmlPreviewView';
import { BrowserView } from '@/features/workbench/browser/BrowserView';
import { CollaborationView } from '@/features/orchestration/collaboration/CollaborationView';
import { DebugView } from '@/features/telemetry/debug/DebugView';
import { DesignSystemView } from '@/features/harness/design-system/DesignSystemView';
import { DictationView } from '@/features/input/dictation/DictationView';
import { MobileView } from '@/features/pages/mobile/MobileView';
import { MemoryView } from '@/features/knowledge/memory/MemoryView';
import { SearchView } from '@/features/workbench/files/SearchView';
import { TasksBoardView } from '@/features/orchestration/tasks-board/TasksBoardView';
import { ScheduleView } from '@/features/orchestration/schedule/ScheduleView';
import { AgentsView } from '@/features/orchestration/agents/AgentsView';
import { SideChannelView } from '@/features/connect/side-channel/SideChannelView';
import { RemoteView } from '@/features/connect/remote/RemoteView';
import { KmsView } from '@/features/connect/kms';
import { AutopilotView } from '@/features/orchestration/autopilot';
import { SquadView } from '@/features/orchestration/squad';
import { MediaView } from '@/features/telemetry/media';
import { HooksView } from '@/features/connect/hooks/HooksView';
import { TracesView } from '@/features/telemetry/traces/TracesView';
import { UsageView } from '@/features/telemetry/usage/UsageView';
import { MarketView } from '@/features/knowledge/market/MarketView';
import { LanesView } from '@/features/orchestration/lanes/LanesView';

// ====== 路由树 (TanStack Router v1 API) ======

const rootRoute = new RootRoute({
  component: AppShell,
});

const indexRoute = new Route({ getParentRoute: () => rootRoute, path: '/', component: ChatView });
const homeRoute = new Route({ getParentRoute: () => rootRoute, path: 'home', component: HomeView });
const chatRoute = new Route({ getParentRoute: () => rootRoute, path: 'chat', component: ChatView });
// ?sub=<childId>:侧栏子代理会话行的只读查看器入口(不 bind 子线程,
// 仅 replay 落盘记录;validateSearch 让非法值不出现在 URL 状态里)。
const chatSessionRoute = new Route({
  getParentRoute: () => chatRoute,
  path: '$sessionId',
  component: ChatView,
  validateSearch: (search: Record<string, unknown>): { sub?: string } => {
    const sub = search.sub;
    return typeof sub === 'string' && sub ? { sub } : {};
  },
});
const sessionsRoute = new Route({ getParentRoute: () => rootRoute, path: 'sessions', component: ThreadsView });
const settingsRoute = new Route({ getParentRoute: () => rootRoute, path: 'settings', component: SettingsView });
const filesRoute = new Route({ getParentRoute: () => rootRoute, path: 'files', component: FilesView });
const modelsRoute = new Route({ getParentRoute: () => rootRoute, path: 'models', component: ModelsView });
const skillsRoute = new Route({ getParentRoute: () => rootRoute, path: 'skills', component: SkillsView });
const workspacesRoute = new Route({ getParentRoute: () => rootRoute, path: 'workspaces', component: WorkspacesView });
const gitRoute = new Route({ getParentRoute: () => rootRoute, path: 'git', component: GitView });
const pullsRoute = new Route({ getParentRoute: () => rootRoute, path: 'pulls', component: PullRequestsView });
const hooksRoute = new Route({ getParentRoute: () => rootRoute, path: 'hooks', component: HooksView });
const terminalRoute = new Route({ getParentRoute: () => rootRoute, path: 'terminal', component: TerminalView });
const planRoute = new Route({ getParentRoute: () => rootRoute, path: 'plan', component: PlanView });
const promptsRoute = new Route({ getParentRoute: () => rootRoute, path: 'prompts', component: PromptsView });
const aboutRoute = new Route({ getParentRoute: () => rootRoute, path: 'about', component: AboutView });
const notificationsRoute = new Route({ getParentRoute: () => rootRoute, path: 'notifications', component: NotificationsView });
const debugRoute = new Route({ getParentRoute: () => rootRoute, path: 'debug', component: DebugView });
const appsRoute = new Route({ getParentRoute: () => rootRoute, path: 'apps', component: AppsView });
const previewRoute = new Route({ getParentRoute: () => rootRoute, path: 'preview', component: HtmlPreviewView });
const browserRoute = new Route({ getParentRoute: () => rootRoute, path: 'browser', component: BrowserView });
const collaborationRoute = new Route({ getParentRoute: () => rootRoute, path: 'collaboration', component: CollaborationView });
const mobileRoute = new Route({ getParentRoute: () => rootRoute, path: 'mobile', component: MobileView });
const dictationRoute = new Route({ getParentRoute: () => rootRoute, path: 'dictation', component: DictationView });
const designSystemRoute = new Route({ getParentRoute: () => rootRoute, path: 'design-system', component: DesignSystemView });
const memoryRoute = new Route({ getParentRoute: () => rootRoute, path: 'memory', component: MemoryView });
const searchRoute = new Route({ getParentRoute: () => rootRoute, path: 'search', component: SearchView });
const tasksRoute = new Route({ getParentRoute: () => rootRoute, path: 'tasks', component: TasksBoardView });
const scheduleRoute = new Route({ getParentRoute: () => rootRoute, path: 'schedule', component: ScheduleView });
const agentsRoute = new Route({ getParentRoute: () => rootRoute, path: 'agents', component: AgentsView });
const sideChannelRoute = new Route({ getParentRoute: () => rootRoute, path: 'side-channels', component: SideChannelView });
const remoteRoute = new Route({ getParentRoute: () => rootRoute, path: 'remote', component: RemoteView });
const kmsRoute = new Route({ getParentRoute: () => rootRoute, path: 'kms', component: KmsView });
const autopilotRoute = new Route({ getParentRoute: () => rootRoute, path: 'autopilot', component: AutopilotView });
const squadRoute = new Route({ getParentRoute: () => rootRoute, path: 'squad', component: SquadView });
const mediaRoute = new Route({ getParentRoute: () => rootRoute, path: 'media', component: MediaView });
const tracesRoute = new Route({ getParentRoute: () => rootRoute, path: 'traces', component: TracesView });
const usageRoute = new Route({ getParentRoute: () => rootRoute, path: 'usage', component: UsageView });
const marketRoute = new Route({ getParentRoute: () => rootRoute, path: 'market', component: MarketView });
const lanesRoute = new Route({ getParentRoute: () => rootRoute, path: 'lanes', component: LanesView });

const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  chatRoute.addChildren([chatSessionRoute]),
  sessionsRoute,
  settingsRoute,
  filesRoute,
  modelsRoute,
  skillsRoute,
  workspacesRoute,
  gitRoute,
  pullsRoute,
  hooksRoute,
  terminalRoute,
  planRoute,
  promptsRoute,
  aboutRoute,
  notificationsRoute,
  debugRoute,
  appsRoute,
  previewRoute,
  browserRoute,
  collaborationRoute,
  mobileRoute,
  dictationRoute,
  designSystemRoute,
  memoryRoute,
  searchRoute,
  tasksRoute,
  scheduleRoute,
  agentsRoute,
  sideChannelRoute,
  remoteRoute,
  kmsRoute,
  autopilotRoute,
  squadRoute,
  mediaRoute,
  tracesRoute,
  usageRoute,
  marketRoute,
  lanesRoute,
]);

// ====== 路由实例 ======

export const router = new Router({ routeTree });

// ====== 类型推导 ======

export type AppRouter = typeof router;

// ====== React Query provider ======

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

export function AppProviders({ children, queryClient = defaultQueryClient }: { children: React.ReactNode; queryClient?: QueryClient }) {
  // 阶段 3a:在 provider mount 时建立唯一的 zhuye_event 订阅。
  // store.subscribe() 是幂等的(防止 React 18 StrictMode 双 mount 重复订阅)。
  // unmount 时清理(返回的 cleanup 调 unlisten + 标记未订阅)。
  useEffect(() => {
    const unsubscribeAgent = useAgentStore.getState().subscribe();
    // editorStore 也订阅同一 agent event bus,把 tool_call_end 中的
    // Diff 内容累计到 FilesView 的 pending 编辑列表(逐块 review)。
    const unsubscribeEditor = useEditorStore.getState().subscribe();
    // v1.x 后台持续运行:后台会话事件走独立通道,本 store 维护运行徽标
    // 与待确认交互投影(主 reducer 只管前台会话)。
    const unsubscribeBackground = useBackgroundSessions.getState().subscribe();
    return () => {
      unsubscribeAgent();
      unsubscribeEditor();
      unsubscribeBackground();
    };
  }, []);
  return <I18nProvider><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></I18nProvider>;
}

// 为向后兼容再导出 ModalStack(保留旧 import 路径)
export { ModalStack };
