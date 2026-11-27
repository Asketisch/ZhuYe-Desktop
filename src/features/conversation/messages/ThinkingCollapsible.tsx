/**
 * ThinkingCollapsible —— 思考过程折叠块（ThinkingDelta 事件与正文
 * `<think>` 分段共用；从 render/MessageList 本地实现升级为有状态切片
 * 组件，对齐 ZCode Reasoning 显示方案）。
 *
 * - 折叠摘要不再倾泻 60 字符原文快照：流式显示「思考中」（扫光文字），
 *   结束后显示「思考 持续了 N 秒」；无打点（回放 / `<think>` 合成条目）
 *   回退「持续了几秒」。
 * - 展开正文限高滚动：流式增长时吸底跟随（离底 ≤2px 保持，上滚暂停，
 *   上下边缘 24px 渐隐）——「思考滚动」的主效果；已结束的内容打开时
 *   停在顶部，阅读位置交给用户。
 * - 文字用弱化色 —— 思考与正式输出视觉分级；compact=活动组内单行态。
 */
import { useState } from 'react';
import { Brain } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { useBottomFollowingScroll } from '@/logic/conversation/messages/useBottomFollowingScroll';
import { Collapsible } from './Collapsible';
import s from '@/render/conversation/messages/MessageList.module.css';

export interface ThinkingCollapsibleProps {
  text: string;
  /** 该思考条目仍在流式生成（turn streaming 且为轮内末条）。 */
  streaming?: boolean;
  /** 流式起止打点（ms epoch，store 打点；回放与 `<think>` 合成条目无）。 */
  startedAt?: number;
  endedAt?: number;
  /** summary 变体（推理摘要）—— 沿用专属标签与 success 档。 */
  summaryLabel?: boolean;
  /** 活动组内的单行态（去卡片边距）。 */
  compact?: boolean;
}

export function ThinkingCollapsible({
  text,
  streaming = false,
  startedAt,
  endedAt,
  summaryLabel = false,
  compact = false,
}: ThinkingCollapsibleProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 展开正文：流式期间吸底跟随，已结束的内容交给用户滚动。
  const scroll = useBottomFollowingScroll(open, text.length, streaming && open);

  const durationLabel =
    startedAt !== undefined && endedAt !== undefined
      ? t('chat.thinking.durationSeconds', { seconds: Math.max(1, Math.ceil((endedAt - startedAt) / 1000)) })
      : t('chat.thinking.durationFewSeconds');
  const label = summaryLabel ? (
    t('chat.thinkingSummary')
  ) : streaming ? (
    <span className={s.thinkingLive}>{t('chat.thinking')}</span>
  ) : (
    `${t('chat.thinking.thought')} ${durationLabel}`
  );

  return (
    <div className={compact ? s.thinkingCompact : undefined}>
      <Collapsible
        icon={<Icon icon={Brain} size={13} />}
        accent={summaryLabel ? 'success' : 'info'}
        open={open}
        onToggle={setOpen}
        label={label}
      >
        <div
          ref={scroll.scrollRef}
          className={s.thinkingScroll}
          onScroll={scroll.onScroll}
          style={scroll.maskStyle}
          data-testid="thinking-scroll"
        >
          <div ref={scroll.contentRef}>
            <pre className={`${s.monoText} ${s.thinkingText}`}>{text}</pre>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
