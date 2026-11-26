/**
 * SubagentViewer —— 子代理会话只读查看器的绑定层（chat 切片）。
 *
 * 数据面：`zhuye_replay_session(subId)` 纯文件回放（不 bind —— 引擎宿主
 * 不可绑子线程，且换绑会让前台线程归属漂移、父会话在飞事件污染查看器）
 * → `turnsFromRollout` 构建本地 turns，零主 store 干预：`loadedSessionId`
 * 保持父会话不变，父会话继续正常收发事件。
 *
 * 消息渲染复用 MessageList 的槽位束；队列槽位空实现（查看器无发送面，
 * 队列归属主会话，不该在这里露出）。
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/utils/i18n';
import { zhuye_replay_session } from '@/utils/commands';
import { turnsFromRollout } from '@/stores/replay';
import { useMessageListScroll } from '@/logic/webview/useMessageListScroll';
import { commandErrorMsg } from '@/logic/chat/ChatBinding';
import { SubagentSessionViewer as DefaultView } from '@/render/conversation/chat/SubagentSessionViewer';
import { ToolCell, ToolOutputBody, ToolGroup, ActivityGroup } from './ToolCells';
import { UserAttachments } from './UserAttachments';
import { Collapsible } from './Collapsible';
import { TurnChangesCard } from './TurnChangesCard';
import { CopyButton } from './CopyButton';
import { Markdown } from '@/components/Markdown';
import type { MessageListSlots, Turn } from '@/contracts/conversation/messageList';

/** 查看器无消息队列 —— MessageList 的队列槽位空实现。 */
function NoQueuedMessages() {
  return null;
}

const MESSAGE_SLOTS: MessageListSlots = {
  ToolCell,
  ToolOutputBody,
  ToolGroup,
  ActivityGroup,
  QueuedMessages: NoQueuedMessages,
  UserAttachments,
  Collapsible,
  TurnChangesCard,
  Markdown,
  CopyButton,
};

export function SubagentViewer({ subId, title, onClose }: {
  subId: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 子会话 id 作为 sessionKey:切换查看的子会话时强制回底。
  const scrollRef = useMessageListScroll(turns ?? [], subId);

  useEffect(() => {
    let cancelled = false;
    setTurns(null);
    setError(null);
    zhuye_replay_session(subId)
      .then((records) => {
        if (cancelled) return;
        setTurns(turnsFromRollout(records).turns);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(t('chat.subagentViewer.loadFailed', { msg: commandErrorMsg(e) }));
      });
    return () => { cancelled = true; };
  }, [subId, t]);

  return <DefaultView
    t={t}
    title={title}
    turns={turns ?? []}
    loading={turns === null && error === null}
    error={error}
    scrollRef={scrollRef}
    onClose={onClose}
    messageSlots={MESSAGE_SLOTS}
  />;
}
