/**
 * GoalBody —— 会话内 chips「目标」的内容体（对标 ZCode ConversationStatusPanel
 * 的 Goal 分区形态）。
 *
 * 面板是**纯只读投影**：目标文本 / 状态 / 轮次 / token / 最近校验结论一律
 * 展示，不带任何编辑入口 —— 目标的唯一输入路径是 composer 的 `/goal`
 * 斜杠命令（空态只留引导：slash 说明 + 「填入 /goal 到输入框」一键预填）。
 * 引擎协议目前只有 Enter/ExitGoalMode（无 pause Op），所以动作面是
 * 「刷新快照 + 退出」；引擎补暂停协议后这里再加 暂停/恢复 按钮。
 */
import { useState } from 'react';
import { CornerDownLeft, RefreshCw, XCircle } from 'lucide-react';
import { Badge, Icon } from '@/features/harness/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import {
  zhuye_exit_goal_mode,
  type GoalSnapshotPayload,
} from '@/utils/commands/goal';
import { emitComposerPrefill } from '@/logic/input/composer/useComposerDraft';
import s from '@/render/harness/shell/SessionChips.module.css';

const STATUS_KEY: Record<string, string> = {
  active: 'harness.corner.goal.status.active',
  paused: 'harness.corner.goal.status.paused',
  blocked: 'harness.corner.goal.status.blocked',
  budget_limited: 'harness.corner.goal.status.budgetLimited',
  complete: 'harness.corner.goal.status.complete',
};

function statusLabel(t: (k: string) => string, status: string | undefined): string {
  return status ? (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status) : t('harness.corner.goal.noSnapshot');
}

/** 目标状态的短标签（chip 徽标用）。 */
export function goalStatusLabel(t: (k: string) => string, status: string | undefined): string {
  return statusLabel(t, status);
}

export function GoalBody() {
  const { t } = useI18n();
  const goalActive = useAgentStore((st) => st.goalActive);
  const snapshot = useAgentStore((st) => st.goalSnapshot);
  const syncGoalSnapshot = useAgentStore((st) => st.syncGoalSnapshot);
  const setGoalActive = useAgentStore((st) => st.setGoalActive);
  const [busy, setBusy] = useState(false);

  const exit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await zhuye_exit_goal_mode();
      setGoalActive(false);
    } finally {
      setBusy(false);
    }
  };

  const status = snapshot?.status;

  return (
    <div className={s.body} data-testid="corner-goal-body">
      {goalActive ? (
        <div className={s.goalBody} data-testid="corner-goal-active">
          <p className={s.goalText}>{snapshot?.goal ?? t('harness.corner.goal.noSnapshot')}</p>
          <div className={s.goalMeta}>
            <Badge variant="neutral">{statusLabel(t, status)}</Badge>
            {snapshot && (
              <span className={s.metaText}>
                {t('harness.corner.goal.turns', { turns: String(snapshot.turn_count) })}
                {' · '}
                {t('harness.corner.goal.tokens', { tokens: String(snapshot.tokens_used) })}
                {snapshot.token_budget
                  ? ` / ${t('harness.corner.goal.budgetShort', { budget: String(snapshot.token_budget) })}`
                  : ''}
              </span>
            )}
          </div>
          {snapshot && snapshot.turns.length > 0 && (
            <ul className={s.verdictList} data-testid="corner-goal-verdicts">
              {snapshot.turns.slice(-3).reverse().map((turn, i) => (
                <li key={`${turn.turn_index}-${i}`} className={s.verdictRow}>
                  <span className={s.verdictIndex}>#{turn.turn_index}</span>
                  <span className={s.verdictKind} data-verdict={turn.verdict.verdict}>
                    {turn.verdict.verdict}
                  </span>
                  <span className={s.verdictText}>
                    {turn.verdict.verdict === 'met'
                      ? turn.verdict.evidence[0]
                      : turn.verdict.verdict === 'unmet'
                        ? turn.verdict.remaining[0]
                        : turn.verdict.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={s.btnRow}>
            <button type="button" className={s.btn} onClick={() => void syncGoalSnapshot()} data-testid="corner-goal-refresh">
              <Icon icon={RefreshCw} size={12} /> {t('harness.corner.goal.refresh')}
            </button>
            <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => void exit()} disabled={busy} data-testid="corner-goal-exit">
              <Icon icon={XCircle} size={12} /> {t('harness.corner.goal.exit')}
            </button>
          </div>
        </div>
      ) : (
        <div className={s.goalForm} data-testid="corner-goal-form">
          {/* 只读面板:目标不在这里输入 —— composer 的 /goal 是唯一入口
              (ZCode 同款)。这里只解释入口 + 一键把 /goal 预填进输入框。 */}
          <p className={s.goalSlashHint} data-testid="corner-goal-slash-hint">
            {t('harness.corner.goal.slashHint')}
          </p>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={() => emitComposerPrefill('/goal ')}
            data-testid="corner-goal-fill-slash"
          >
            <CornerDownLeft size={12} /> {t('harness.corner.goal.slashFill')}
          </button>
        </div>
      )}
    </div>
  );
}

export type { GoalSnapshotPayload };
