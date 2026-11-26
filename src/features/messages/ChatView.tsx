import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ChatBinding } from '@/logic/chat/ChatBinding';
import { ChatView as DefaultView } from '@/render/chat/ChatView';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ChatHero } from '@/features/home/ChatHero';
import { ContextBanner } from './ContextBanner';
import { DiffViewer } from '@/features/git/DiffViewer';
import { WorkHead, ViewRing } from '@/features/shell/session/WorkHead';
import { SessionDock } from '@/features/shell/session/SessionDock';
import { StatusPanel } from '@/features/shell/session/StatusPanel';
import { ApprovalTakeover, QuestionTakeover, AskUserTakeover } from '@/features/shell/session/Takeovers';
import { TrajView } from '@/features/shell/session/TrajView';
import { BottomTabs } from '@/features/shell/session/BottomTabs';
import { SubagentViewer } from './SubagentViewer';

export { editRewindTargetFor } from '@/logic/chat/ChatBinding';
const slots = { MessageList, Composer, ChatHero, ContextBanner,
  DiffViewer, WorkHead, ViewRing, SessionDock, StatusPanel, ApprovalTakeover, QuestionTakeover, AskUserTakeover,
  TrajView, BottomTabs, SubagentViewer };

export function ChatView() {
  const renderer = useRenderer();
  return <ChatBinding view={renderer?.ChatView ?? DefaultView} slots={slots} />;
}
