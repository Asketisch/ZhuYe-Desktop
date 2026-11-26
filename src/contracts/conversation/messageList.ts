import type { ComponentProps, ComponentType, RefObject } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { Turn } from '@/stores/agent/types';
export type { Turn, TurnItem } from '@/stores/agent/types';
import type { ToolCell, ToolOutputBody, ToolGroup, ActivityGroup, ActivityEntryData } from '@/features/messages/ToolCells';
import type { QueuedMessages } from '@/features/messages/QueuedMessages';
import type { UserAttachments } from '@/features/messages/UserAttachments';
import type { Collapsible } from '@/features/messages/Collapsible';
import type { TurnChangesCard } from '@/features/messages/TurnChangesCard';
import type { Markdown } from '@/components/Markdown';
import type { CopyButtonProps } from '@/contracts/conversation/copyButton';

export interface MessageListSlots {
  ToolCell: ComponentType<ComponentProps<typeof ToolCell>>;
  ToolOutputBody: ComponentType<ComponentProps<typeof ToolOutputBody>>;
  /** 连续工具调用的聚合组（对话式 agent 产品惯用的摘要行）。 */
  ToolGroup: ComponentType<ComponentProps<typeof ToolGroup>>;
  /** 工具 + 思考混合活动组（思考不打断工具流,同组折叠（对话式 agent 产品惯例）。 */
  ActivityGroup: ComponentType<ComponentProps<typeof ActivityGroup>>;
  QueuedMessages: ComponentType<ComponentProps<typeof QueuedMessages>>;
  UserAttachments: ComponentType<ComponentProps<typeof UserAttachments>>;
  Collapsible: ComponentType<ComponentProps<typeof Collapsible>>;
  /** 每轮末尾的「本轮改动」卡（v1.13：逐轮汇总 + 逐文件审查）。 */
  TurnChangesCard: ComponentType<ComponentProps<typeof TurnChangesCard>>;
  Markdown: ComponentType<ComponentProps<typeof Markdown>>;
  CopyButton: ComponentType<CopyButtonProps>;
}

export interface MessageListViewProps {
  t: I18nContextValue['t'];
  turns: readonly Turn[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onForkTurn?: (turnId: string, branch: string) => void;
  onRewindTurn?: (turnId: string) => void;
  onEditTurn?: (turnId: string) => void;
  onRegenerateTurn?: (turnId: string) => void;
  onContinueTurn?: (turnId: string) => void;
  slots: MessageListSlots;
}

export type { ActivityEntryData };
