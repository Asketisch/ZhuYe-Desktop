import { useRenderView } from '@/logic/renderer/useRenderView';
import { MessageListBinding } from '@/logic/messages/MessageListBinding';
import { MessageList as DefaultView } from '@/render/conversation/messages/MessageList';
import { ToolCell, ToolOutputBody, ToolGroup, ActivityGroup } from './ToolCells';
import { QueuedMessages } from './QueuedMessages';
import { UserAttachments } from './UserAttachments';
import { Collapsible } from './Collapsible';
import { TurnChangesCard } from './TurnChangesCard';
import { Markdown } from '@/components/Markdown';
import { CopyButton } from './CopyButton';

export interface MessageListProps {
  onForkTurn?: (turnId: string, branch: string) => void;
  onRewindTurn?: (turnId: string) => void;
  onEditTurn?: (turnId: string) => void;
  onRegenerateTurn?: (turnId: string) => void;
  onContinueTurn?: (turnId: string) => void;
}

export function MessageList(props: MessageListProps = {}) {
  const View = useRenderView('MessageList', DefaultView);
  return <MessageListBinding view={View} {...props}
    slots={{
      ToolCell, ToolOutputBody, ToolGroup, ActivityGroup, QueuedMessages,
      UserAttachments, Collapsible, TurnChangesCard, Markdown, CopyButton,
    }} />;
}
