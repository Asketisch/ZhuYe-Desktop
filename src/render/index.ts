import type { Renderer } from '@/contracts/renderer';
import { appearance } from './appearance';
import { AppShell } from './shell/AppShell';
import { Composer } from './composer/Composer';
import { ChatView } from './chat/ChatView';
import { SettingsView } from './settings/SettingsView';
import { ConfigHealthBanner } from './settings/ConfigHealthBanner';
import { TerminalView } from './terminal/TerminalView';
import { DesignSystemView } from './design-system-page/DesignSystemView';
import { ModalStack } from './modals/ModalStack';
import { TitleBar } from './shell/TitleBar';
import { StatusBar } from './shell/StatusBar';
import { Sidebar } from './sessions/Sidebar';
import { MessageList } from './messages/MessageList';
import { ActivityBar } from './shell/ActivityBar';
import { AboutView } from './about/AboutView';
import { AppsView } from './apps/AppsView';
import { DebugView } from './debug/DebugView';
import { AgentsView } from './agents/AgentsView';
import { AutopilotView } from './autopilot/AutopilotView';
import { CollaborationView } from './collaboration/CollaborationView';
import { DictationView } from './dictation/DictationView';
import { FilesView } from './files/FilesView';
import { GitView } from './git/GitView';
import { PullRequestsView } from './git/PullRequestsView';
import { HomeView } from './home/HomeView';
import { HooksView } from './hooks/HooksView';
import { ImportView } from './import/ImportView';
import { KmsView } from './kms/KmsView';
import { MediaView } from './media/MediaView';
import { MemoryView } from './memory/MemoryView';
import { MobileView } from './mobile/MobileView';
import { ModelsView } from './models/ModelsView';
import { NotificationsView } from './notifications/NotificationsView';
import { PlanView } from './plan/PlanView';
import { HtmlPreviewView } from './preview/HtmlPreviewView';
import { PromptsView } from './prompts/PromptsView';
import { RemoteView } from './remote/RemoteView';
import { ScheduleView } from './schedule/ScheduleView';
import { SearchView } from './search/SearchView';
import { SideChannelView } from './side-channel/SideChannelView';
import { SkillsView } from './skills/SkillsView';
import { SquadView } from './squad/SquadView';
import { TasksBoardView } from './tasks-board/TasksBoardView';
import { ThreadsView } from './threads/ThreadsView';
import { TracesView } from './traces/TracesView';
import { UsageView } from './usage/UsageView';
import { WorkspacesView } from './workspaces/WorkspacesView';
import { MarketView } from './market/MarketView';
import { LanesView } from './lanes/LanesView';

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
  ImportView,
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
