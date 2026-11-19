import type { ComponentProps, ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { PendingApproval, PendingQuestion, PendingAskUser, Turn } from '@/stores/agent/types';
import type { GitSummary } from '@/logic/chat/gitSummary';
import type { WorkHead, ViewRing } from '@/features/shell/zcode/WorkHead';
import type { MessageList } from '@/features/messages/MessageList';

export interface ChatSlots {
  WorkHead: ComponentType<ComponentProps<typeof WorkHead>>;
  ViewRing: ComponentType<ComponentProps<typeof ViewRing>>;
  MessageList: ComponentType<ComponentProps<typeof MessageList>>;
  Composer: ComponentType;
  ChatHero: ComponentType;
  QuickPromptRow: ComponentType;
  ContextBanner: ComponentType;
  ScmChanges: ComponentType;
  TrajView: ComponentType;
  ZDock: ComponentType<{ goalActive: boolean; goalText: string; turnRunning: boolean }>;
  ApprovalTakeover: ComponentType<{ approval: PendingApproval }>;
  QuestionTakeover: ComponentType<{ question: PendingQuestion }>;
  AskUserTakeover: ComponentType<{ askUser: PendingAskUser }>;
  BottomTabs: ComponentType<{ open: boolean; onClose: () => void }>;
  DiffViewer: ComponentType<{ diff: string; emptyMessage?: string }>;
}

export interface ChatViewProps {
  t: I18nContextValue['t'];
  sessionId?: string;
  title: string;
  loading: boolean;
  error: string | null;
  isLoaded: boolean;
  turns: readonly Turn[];
  turnCount: number;
  forking: boolean;
  hero: boolean;
  split: boolean;
  diffLoading: boolean;
  diffText: string | null;
  viewMode: 'chat' | 'traj';
  onViewModeChange: (mode: 'chat' | 'traj') => void;
  bottomOpen: boolean;
  rightOpen: boolean;
  gitSummary: GitSummary | null;
  goalActive: boolean;
  goalText: string;
  turnRunning: boolean;
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  askUser: PendingAskUser | null;
  onFork: (branch: string, turnId?: string) => void;
  onRetry: () => void;
  onExport: () => void;
  onToggleTerminal: () => void;
  onCloseTerminal: () => void;
  onToggleRight: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onRewind: (turnId: string) => void;
  onEdit: (turnId: string) => void;
  onRegenerate: (turnId: string) => void;
  onContinue: () => void;
  slots: ChatSlots;
}
