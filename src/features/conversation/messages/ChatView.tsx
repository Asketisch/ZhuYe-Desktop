import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ChatBinding } from '@/logic/chat/ChatBinding';
import { ChatView as DefaultView } from '@/render/chat/ChatView';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ChatHero } from '@/features/conversation/home/ChatHero';
import { ContextBanner } from './ContextBanner';
import { DiffViewer } from '@/features/workbench/git/DiffViewer';
import { WorkHead, ViewRing } from '@/features/harness/shell/session/WorkHead';
import { SessionDock } from '@/features/harness/shell/session/SessionDock';
import { SessionCapsule } from '@/features/harness/shell/session/SessionCapsule';
import { ApprovalTakeover, QuestionTakeover, AskUserTakeover } from '@/features/harness/shell/session/Takeovers';
import { TrajView } from '@/features/harness/shell/session/TrajView';
import { BottomTabs } from '@/features/harness/shell/session/BottomTabs';
import { SubagentViewer } from './SubagentViewer';

export { editRewindTargetFor } from '@/logic/chat/ChatBinding';
const slots = { MessageList, Composer, ChatHero, ContextBanner,
  DiffViewer, WorkHead, ViewRing, SessionDock, SessionCapsule, ApprovalTakeover, QuestionTakeover, AskUserTakeover,
  TrajView, BottomTabs, SubagentViewer };

export function ChatView() {
  const renderer = useRenderer();
  return <ChatBinding view={renderer?.ChatView ?? DefaultView} slots={slots} />;
}
