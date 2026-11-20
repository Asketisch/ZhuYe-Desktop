/**
 * GoalWidget —— 右上角目标模式。
 *
 * 活跃时展示目标 / 状态 / 进度 / 最近校验结论，可退出、可刷新快照
 * （`syncGoalSnapshot` 是 store 既有的权威校准 action）；空闲时提供
 * 内联「设目标」表单（目标文本 + 可选 token 预算）。
 */
import { useState } from 'react';
import { Loader2, RefreshCw, Target, XCircle } from 'lucide-react';
import { Badge, Icon } from '@/features/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import {
  zhuye_enter_goal_mode,
  zhuye_exit_goal_mode,
  type GoalSnapshotPayload,
} from '@/utils/commands/goal';
import { CornerWidget } from './CornerWidget';
import s from '@/render/shell/CornerWidgets.module.css';

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

export function GoalWidget() {
  const { t } = useI18n();
  const goalActive = useAgentStore((st) => st.goalActive);
  const snapshot = useAgentStore((st) => st.goalSnapshot);
  const syncGoalSnapshot = useAgentStore((st) => st.syncGoalSnapshot);
  const setGoalActive = useAgentStore((st) => st.setGoalActive);
  const [goalText, setGoalText] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    const goal = goalText.trim();
    if (!goal || busy) return;
    setBusy(true);
    try {
      const parsed = budget.trim() === '' ? undefined : Number(budget.trim());
      await zhuye_enter_goal_mode(goal, undefined, Number.isFinite(parsed) && parsed! > 0 ? parsed : undefined);
      setGoalActive(true);
      await syncGoalSnapshot();
      setGoalText('');
      setBudget('');
    } finally {
      setBusy(false);
    }
  };

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
    <CornerWidget
      testId="goal"
      icon={<Target size={13} />}
      label={t('harness.corner.goal.title')}
      badge={goalActive ? statusLabel(t, status) : t('harness.corner.goal.setIdle')}
      active={goalActive}
      defaultOpen={goalActive}
    >
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
          <textarea
            className={s.goalInput}
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder={t('harness.corner.goal.placeholder')}
            rows={2}
            data-testid="corner-goal-input"
          />
          <input
            className={s.budgetInput}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder={t('harness.corner.goal.budget')}
            inputMode="numeric"
            data-testid="corner-goal-budget"
          />
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={() => void start()}
            disabled={busy || goalText.trim() === ''}
            data-testid="corner-goal-start"
          >
            {busy ? <Loader2 size={12} className={s.spin} /> : <Target size={12} />}
            {t('harness.corner.goal.enter')}
          </button>
        </div>
      )}
    </CornerWidget>
  );
}

export type { GoalSnapshotPayload };
