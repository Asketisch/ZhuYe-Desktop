import type { Renderer } from '@/contracts/renderer';
import { appearance } from './appearance';
import { AppShell } from '@/render/harness/shell/AppShell';
import { Composer } from '@/render/input/composer/Composer';
import { ChatView } from '@/render/conversation/chat/ChatView';
import { SettingsView } from '@/render/harness/settings/SettingsView';
import { ConfigHealthBanner } from '@/render/harness/settings/ConfigHealthBanner';
import { TerminalView } from '@/render/workbench/terminal/TerminalView';
import { DesignSystemView } from '@/render/harness/design-system-page/DesignSystemView';
import { ModalStack } from '@/render/harness/modals/ModalStack';
import { TitleBar } from '@/render/harness/shell/TitleBar';
import { StatusBar } from '@/render/harness/shell/StatusBar';
import { Sidebar } from '@/render/conversation/sessions/Sidebar';
import { MessageList } from '@/render/conversation/messages/MessageList';
import { ActivityBar } from '@/render/harness/shell/ActivityBar';
import { AboutView } from '@/render/pages/about/AboutView';
import { AppsView } from '@/render/knowledge/apps/AppsView';
import { DebugView } from '@/render/telemetry/debug/DebugView';
import { AgentsView } from '@/render/orchestration/agents/AgentsView';
import { AutopilotView } from '@/render/orchestration/autopilot/AutopilotView';
import { CollaborationView } from '@/render/orchestration/collaboration/CollaborationView';
import { DictationView } from '@/render/input/dictation/DictationView';
import { FilesView } from '@/render/workbench/files/FilesView';
import { GitView } from '@/render/workbench/git/GitView';
import { PullRequestsView } from '@/render/workbench/git/PullRequestsView';
import { HomeView } from '@/render/conversation/home/HomeView';
import { HooksView } from '@/render/connect/hooks/HooksView';
import { KmsView } from '@/render/connect/kms/KmsView';
import { MediaView } from '@/render/telemetry/media/MediaView';
import { MemoryView } from '@/render/knowledge/memory/MemoryView';
import { MobileView } from '@/render/pages/mobile/MobileView';
import { ModelsView } from '@/render/knowledge/models/ModelsView';
import { NotificationsView } from '@/render/telemetry/notifications/NotificationsView';
import { PlanView } from '@/render/orchestration/plan/PlanView';
import { HtmlPreviewView } from '@/render/workbench/preview/HtmlPreviewView';
import { PromptsView } from '@/render/knowledge/prompts/PromptsView';
import { RemoteView } from '@/render/connect/remote/RemoteView';
import { ScheduleView } from '@/render/orchestration/schedule/ScheduleView';
import { SearchView } from '@/render/workbench/search/SearchView';
import { SideChannelView } from '@/render/connect/side-channel/SideChannelView';
import { SkillsView } from '@/render/knowledge/skills/SkillsView';
import { SquadView } from '@/render/orchestration/squad/SquadView';
import { TasksBoardView } from '@/render/orchestration/tasks-board/TasksBoardView';
import { ThreadsView } from '@/render/conversation/threads/ThreadsView';
import { TracesView } from '@/render/telemetry/traces/TracesView';
import { UsageView } from '@/render/telemetry/usage/UsageView';
import { WorkspacesView } from '@/render/pages/workspaces/WorkspacesView';
import { MarketView } from '@/render/knowledge/market/MarketView';
import { LanesView } from '@/render/orchestration/lanes/LanesView';

/** 桌面端默认渲染实现。 */
export const renderer: Renderer = {
  appearance, AppShell, Composer, ChatView, SettingsView, ConfigHealthBanner, TerminalView, DesignSystemView, ModalStack, TitleBar, StatusBar, Sidebar, MessageList, ActivityBar,
  AboutView,
  AppsView,
  DebugView,
  AgentsView,
  AutopilotView,
  CollaborationView,
  DictationView,
  FilesView,
  GitView,
  PullRequestsView,
  HomeView,
  HooksView,
  KmsView,
  MediaView,
  MemoryView,
  MobileView,
  ModelsView,
  NotificationsView,
  PlanView,
  HtmlPreviewView,
  PromptsView,
  RemoteView,
  ScheduleView,
  SearchView,
  SideChannelView,
  SkillsView,
  SquadView,
  TasksBoardView,
  ThreadsView,
  TracesView,
  UsageView,
  WorkspacesView,
  MarketView,
  LanesView,
};
