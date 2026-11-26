/**
 * TurnChangesCard —— 每轮末尾的「本轮改动」卡（ZCode v4 同款形态）。
 *
 * v1.13:原先全会话改动汇总成一块面板、挂在消息流**顶部**;现改为
 * **每轮一张、挂在该轮 assistant 内容之后** —— 改动是逐轮产生的,
 * 跟着轮次走才读得懂「这一轮改了什么」。
 *
 * 结构（对齐 ZCode `ConversationFileSummaryPanel`）：
 *   折叠头：`▸ 本轮改动 N 个文件 (+A −D)`
 *   展开体：逐文件行 = 文件名 + `+A −D` + 「审查」按钮
 *
 * 「审查」就地展开该文件的 unified diff（`TurnDiffReview`）—— diff 数据
 * 已在手（工具输出的 `metadata.diff`），不需要额外 IPC。
 */
import { useMemo } from 'react';
import { FileDiff } from 'lucide-react';
import { Collapsible } from '@/features/conversation/messages/Collapsible';
import { Icon } from '@/features/harness/design-system';
import { TurnDiffReview } from '@/features/conversation/messages/TurnDiffReview';
import {
  countDiffLines,
  deriveChangesFromTurn,
  summarizeTurnChanges,
  type TurnChange,
} from '@/features/conversation/messages/turnChanges';
import { useI18n } from '@/utils/i18n';
import type { Turn } from '@/stores/agent/types';
import s from '@/render/conversation/messages/TurnChangesCard.module.css';

export interface TurnChangesCardProps {
  /** 该轮的完整 items（用于派生改动）。 */
  turn: Turn;
}

export function TurnChangesCard({ turn }: TurnChangesCardProps) {
  const { t } = useI18n();
  const changes = useMemo(() => deriveChangesFromTurn(turn), [turn]);
  const summary = useMemo(() => summarizeTurnChanges(changes), [changes]);

  // 无改动 → 不渲染（每一轮都挂一个空卡会让消息流噪声化）。
  if (changes.length === 0) return null;

  return (
    <div className={s.card} data-testid="turn-changes-card">
      <Collapsible
        icon={<Icon icon={FileDiff} size={13} />}
        accent="default"
        label={
          <span className={s.headLabel}>
            <span>{t('turnChanges.title')}</span>
            <span className={s.count}>{summary.files}</span>
            <span className={s.stat} data-kind="added">+{summary.added}</span>
            <span className={s.stat} data-kind="removed">−{summary.removed}</span>
          </span>
        }
      >
        <ul className={s.list} data-testid="turn-changes-list">
          {changes.map((change) => (
            <TurnChangeRow key={change.path} change={change} />
          ))}
        </ul>
      </Collapsible>
    </div>
  );
}

/** 单个文件行 —— 文件名 + 行数 + 「审查」按钮 + 就地 diff 预览。 */
function TurnChangeRow({ change }: { change: TurnChange }) {
  const { t } = useI18n();
  const stat = useMemo(() => countDiffLines(change.diff), [change.diff]);

  return (
    <li className={s.row} data-testid="turn-change-row" data-error={change.isError || undefined}>
      <span className={s.path} title={change.path}>{shortPath(change.path)}</span>
      <span className={s.stat} data-kind="added">+{stat.added}</span>
      <span className={s.stat} data-kind="removed">−{stat.removed}</span>
      {change.isError && <span className={s.failed}>{t('turnChanges.failed')}</span>}
      <TurnDiffReview path={change.path} diff={change.diff} />
    </li>
  );
}

/**
 * 路径缩短：只显示工作区相对的部分。
 *
 * 工具给的 `metadata.path` 是绝对路径;直接显示会把整个用户目录前缀
 * 铺满一行,真正有用的文件名反而被挤掉 —— 取最后两段(父目录 + 文件名)
 * 作为展示,完整路径留在 `title` 里。
 */
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}
