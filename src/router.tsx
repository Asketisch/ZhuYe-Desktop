/**
 * TanStack Router v1 —— ReflectDesktop 路由树。
 *
 * 阶段 2：root component 从 AppLayout 切到 IDE 式 AppShell。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, RootRoute, Router } from '@tanstack/react-router';
import React, { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useEditorStore } from '@/stores/editorStore';
import { ModalStack } from '@/features/modals';
import { AppShell } from '@/features/shell/AppShell';
import { I18nProvider } from '@/utils/i18n';

// ====== 路由组件 ======
import { ChatView } from '@/features/messages/ChatView';
import { SettingsView } from '@/features/settings/SettingsView';
import { HomeView } from '@/features/home/HomeView';
import { ThreadsView } from '@/features/threads/ThreadsView';
import { ModelsView } from '@/features/models/ModelsView';
import { FilesView } from '@/features/files/FilesView';
import { GitView } from '@/features/git/GitView';
import { PullRequestsView } from '@/features/git/PullRequestsView';
import { SkillsView } from '@/features/skills/SkillsView';
import { WorkspacesView } from '@/features/workspaces/WorkspacesView';
import { PlanView } from '@/features/plan/PlanView';
import { PromptsView } from '@/features/prompts/PromptsView';
import { NotificationsView } from '@/features/notifications/NotificationsView';
import { TerminalView } from '@/features/terminal/TerminalView';
import { AboutView } from '@/features/about/AboutView';
import { AppsView } from '@/features/apps/AppsView';
import { CollaborationView } from '@/features/collaboration/CollaborationView';
import { DebugView } from '@/features/debug/DebugView';
import { DesignSystemView } from '@/features/design-system/DesignSystemView';
import { DictationView } from '@/features/dictation/DictationView';
import { MobileView } from '@/features/mobile/MobileView';
import { MemoryView } from '@/features/memory/MemoryView';
import { SearchView } from '@/features/files/SearchView';
import { TasksBoardView } from '@/features/tasks-board/TasksBoardView';
import { ScheduleView } from '@/features/schedule/ScheduleView';
import { AgentsView } from '@/features/agents/AgentsView';
import { SideChannelView } from '@/features/side-channel/SideChannelView';
import { RemoteView } from '@/features/remote/RemoteView';
import { KmsView } from '@/features/kms';
import { AutopilotView } from '@/features/autopilot';
import { SquadView } from '@/features/squad';
import { MediaView } from '@/features/media';
import { HooksView } from '@/features/hooks/HooksView';
import { TracesView } from '@/features/traces/TracesView';
import { UsageView } from '@/features/usage/UsageView';

// ====== 路由树 (TanStack Router v1 API) ======

const rootRoute = new RootRoute({
  component: AppShell,
});

const indexRoute = new Route({ getParentRoute: () => rootRoute, path: '/', component: ChatView });
const homeRoute = new Route({ getParentRoute: () => rootRoute, path: 'home', component: HomeView });
const chatRoute = new Route({ getParentRoute: () => rootRoute, path: 'chat', component: ChatView });
const chatSessionRoute = new Route({ getParentRoute: () => chatRoute, path: '$sessionId', component: ChatView });
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
]);

// ====== 路由实例 ======

export const router = new Router({ routeTree });

// ====== 类型推导 ======

export type AppRouter = typeof router;

// ====== React Query provider ======

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  // 阶段 3a:在 provider mount 时建立唯一的 reflect_event 订阅。
  // store.subscribe() 是幂等的(防止 React 18 StrictMode 双 mount 重复订阅)。
  // unmount 时清理(返回的 cleanup 调 unlisten + 标记未订阅)。
  useEffect(() => {
    const unsubscribeAgent = useAgentStore.getState().subscribe();
    // editorStore 也订阅同一 agent event bus,把 tool_call_end 中的
    // Diff 内容累计到 FilesView 的 pending 编辑列表(Cursor 式 review)。
    const unsubscribeEditor = useEditorStore.getState().subscribe();
    return () => {
      unsubscribeAgent();
      unsubscribeEditor();
    };
  }, []);
  return <I18nProvider><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></I18nProvider>;
}

// 为向后兼容再导出 ModalStack(保留旧 import 路径)
export { ModalStack };
