import type { ComponentProps, ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { PendingApproval, PendingQuestion, PendingAskUser, Turn } from '@/stores/agent/types';
import type { GitSummary } from '@/logic/chat/gitSummary';
import type { WorkHead, ViewRing } from '@/features/shell/session/WorkHead';
import type { MessageList } from '@/features/messages/MessageList';

export interface ChatSlots {
  WorkHead: ComponentType<ComponentProps<typeof WorkHead>>;
  ViewRing: ComponentType<ComponentProps<typeof ViewRing>>;
  MessageList: ComponentType<ComponentProps<typeof MessageList>>;
  Composer: ComponentType;
  ChatHero: ComponentType;
  ContextBanner: ComponentType;
  TrajView: ComponentType;
  SessionDock: ComponentType<{ goalActive: boolean; goalText: string; turnRunning: boolean }>;
  /** 会话区的折叠胶囊（目标 / 进程 / 上下文；v1.13 取代原 300px 右列）。 */
  SessionCapsule: ComponentType<{ goalActive: boolean; turnRunning: boolean }>;
  ApprovalTakeover: ComponentType<{ approval: PendingApproval }>;
  QuestionTakeover: ComponentType<{ question: PendingQuestion }>;
  AskUserTakeover: ComponentType<{ askUser: PendingAskUser }>;
  BottomTabs: ComponentType<{ open: boolean; onClose: () => void }>;
  DiffViewer: ComponentType<{ diff: string; emptyMessage?: string }>;
  /** v1.x:子代理会话只读查看器（侧栏子会话行 → ?sub=<childId>）。
   *  不 bind 子线程（引擎宿主拒绝），仅 replay 落盘记录。 */
  SubagentViewer: ComponentType<{
    parentSessionId: string;
    subId: string;
    title: string;
    onClose: () => void;
  }>;
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
  onCloseTerminal: () => void;
  onOpenSettings: () => void;
  onRewind: (turnId: string) => void;
  onEdit: (turnId: string) => void;
  onRegenerate: (turnId: string) => void;
  onContinue: () => void;
  slots: ChatSlots;
}
