import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ChatBinding } from '@/logic/chat/ChatBinding';
import { ChatView as DefaultView } from '@/render/chat/ChatView';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ChatHero, QuickPromptRow } from '@/features/home/ChatHero';
import { ContextBanner } from './ContextBanner';
import { ScmChanges } from './ScmChanges';
import { DiffViewer } from '@/features/git/DiffViewer';
import { WorkHead, ViewRing } from '@/features/shell/zcode/WorkHead';
import { ZDock } from '@/features/shell/zcode/ZDock';
import { ApprovalTakeover, QuestionTakeover, AskUserTakeover } from '@/features/shell/zcode/Takeovers';
import { TrajView } from '@/features/shell/zcode/TrajView';
import { BottomTabs } from '@/features/shell/zcode/BottomTabs';

export { editRewindTargetFor } from '@/logic/chat/ChatBinding';
const slots = { MessageList, Composer, ChatHero, QuickPromptRow, ContextBanner, ScmChanges,
  DiffViewer, WorkHead, ViewRing, ZDock, ApprovalTakeover, QuestionTakeover, AskUserTakeover,
  TrajView, BottomTabs };

export function ChatView() {
  const renderer = useRenderer();
  return <ChatBinding view={renderer?.ChatView ?? DefaultView} slots={slots} />;
}
