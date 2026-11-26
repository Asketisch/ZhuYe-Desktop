import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { useMessageListScroll } from '@/logic/workbench/webview/useMessageListScroll';
import type { MessageListSlots, MessageListViewProps } from '@/contracts/conversation/messageList';

export function MessageListBinding({ view: View, slots, onForkTurn, onRewindTurn, onEditTurn, onRegenerateTurn, onContinueTurn }: {
  view: ComponentType<MessageListViewProps>;
  slots: MessageListSlots;
} & Pick<MessageListViewProps, 'onForkTurn' | 'onRewindTurn' | 'onEditTurn' | 'onRegenerateTurn' | 'onContinueTurn'>) {
  const turns = useAgentStore((state) => state.turns);
  // 会话标识:换会话时强制回底(容器 DOM 复用,旧 scrollTop 会让新会话
  // 停在半路)。
  const sessionId = useAgentStore((state) => state.loadedSessionId);
  const { t } = useI18n(); const scrollRef = useMessageListScroll(turns, sessionId);
  return <View t={t} turns={turns} scrollRef={scrollRef} slots={slots}
    onForkTurn={onForkTurn} onRewindTurn={onRewindTurn} onEditTurn={onEditTurn}
    onRegenerateTurn={onRegenerateTurn} onContinueTurn={onContinueTurn} />;
}
