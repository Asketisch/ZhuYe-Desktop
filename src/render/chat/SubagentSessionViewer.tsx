/**
 * 子代理会话只读查看器（v1.x）—— 侧栏子会话行（?sub=<childId>）的主区
 * 挂载形态。纯展示：replay 落盘记录构建的 turns 由绑定层（features 层）
 * 注入，渲染层不持状态、不触 bind —— 引擎宿主不可绑子线程，且主区不
 * 换绑才能保证父会话的在飞事件不污染查看器、composer 不误写。
 */
import { X } from 'lucide-react';
import type { RefObject } from 'react';
import type { MessageListViewProps, MessageListSlots, Turn } from '@/contracts/messageList';
import { MessageList } from '../messages/MessageList';
import { Icon } from '../design-system/Icon';
import s from './SubagentSessionViewer.module.css';

export interface SubagentSessionViewerProps {
  t: MessageListViewProps['t'];
  /** 子会话标题（列表派生，回退短 id）。 */
  title: string;
  turns: readonly Turn[];
  loading: boolean;
  error: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 返回主会话（父会话）。 */
  onClose: () => void;
  /** 消息流槽位（绑定层组装；队列槽位为空实现）。 */
  messageSlots: MessageListSlots;
}

export function SubagentSessionViewer({
  t, title, turns, loading, error, scrollRef, onClose, messageSlots,
}: SubagentSessionViewerProps) {
  return (
    <div className={s.wrap} data-testid="subagent-session-viewer">
      <div className={s.banner}>
        <span className={s.title} title={title}>{title}</span>
        <span className={s.badge}>
          {t('chat.subagentViewer.title')} · {t('chat.subagentViewer.readOnly')}
        </span>
        <button
          type="button"
          className={s.close}
          aria-label={t('chat.subagentViewer.close')}
          title={t('chat.subagentViewer.close')}
          data-testid="subagent-viewer-close"
          onClick={onClose}
        >
          <Icon icon={X} size={14} />
          <span>{t('chat.subagentViewer.close')}</span>
        </button>
      </div>
      <div className={s.body}>
        {loading && <div className={s.note}>{t('sidebar.loading')}</div>}
        {!loading && error && <div className={s.note} role="alert">{error}</div>}
        {!loading && !error && (
          <MessageList t={t} turns={turns} scrollRef={scrollRef} slots={messageSlots} />
        )}
      </div>
    </div>
  );
}
