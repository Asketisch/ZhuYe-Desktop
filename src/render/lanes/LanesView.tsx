/**
 * 泳道页纯展示组件 —— 消费 harness.css 全局类(monochrome 设计),
 * 不携带任何状态与 IPC 逻辑。
 */
import { Fragment } from 'react';
import { ArrowLeft, RefreshCw, Square } from 'lucide-react';
import type { LaneRow, LanesViewProps } from '@/contracts/lanes';

/** token 数紧凑格式:1200 → 1.2k。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${n} tok`;
}

/** 秒数格式:65 → 1m05s,6.4 → 6.4s。 */
function fmtDuration(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m${String(s).padStart(2, '0')}s`;
  }
  return `${sec.toFixed(1)}s`;
}

export function LanesView({
  t, sessionLabel, runningCount, doneCount, failedCount, lanes, hasRunning, busy,
  onBack, onRefresh, onCancelAll,
}: LanesViewProps) {
  return (
    <div className="lanes" data-testid="lanes-view">
      <header className="lanes-head">
        <button type="button" className="tb-btn" aria-label={t('harness.lanes.back')} onClick={onBack} data-testid="lanes-back">
          <ArrowLeft size={14} strokeWidth={1.75} />
        </button>
        <div>
          <div className="lanes-title">{t('harness.lanes.title')}</div>
          <div className="lanes-sub">
            {sessionLabel
              ? t('harness.lanes.sessionSub', { id: sessionLabel, n: runningCount })
              : t('harness.lanes.sessionSubNoSession', { n: runningCount })}
          </div>
        </div>
        <div className="market-tools">
          <button
            type="button"
            className="btn"
            disabled={busy || !hasRunning}
            onClick={onCancelAll}
            data-testid="lanes-cancel-all"
          >
            <Square size={12} strokeWidth={1.75} />
            {t('harness.lanes.cancel')}
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label={t('harness.lanes.refresh')}
            onClick={onRefresh}
            data-testid="lanes-refresh"
          >
            <RefreshCw size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>
      <div className="lanes-body">
        {lanes.length === 0 ? (
          <div className="lanes-inner">
            <p className="us-empty" data-testid="lanes-empty">{t('harness.lanes.empty')}</p>
          </div>
        ) : (
          <div className="lanes-inner">
            <div className="lanes-sum" data-testid="lanes-sum">
              <span>
                {t('harness.lanes.active')} <b>{runningCount}</b>
              </span>
              <span>
                {t('harness.lanes.done')} <b>{doneCount}</b>
              </span>
              <span>
                {t('harness.lanes.failed')} <b>{failedCount}</b>
              </span>
              <span className="cap">{runningCount} / 16</span>
            </div>
            {lanes.map((lane, index) => (
              <LaneRowView key={lane.id} lane={lane} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单条泳道:左身份 / 中执行流 / 右指标 + 底部进度条。 */
function LaneRowView({ lane, index }: { lane: LaneRow; index: number }) {
  return (
    <div className={`lane ${lane.tone}`} data-testid={`lanes-record-${index}`}>
      <div className="lane-id">
        <div className="lane-nm">
          <span className="lane-dot" aria-hidden="true" />
          {lane.name}
        </div>
        <div className="lane-task" title={lane.task}>{lane.task || '—'}</div>
      </div>
      <div className="lane-flow">
        {lane.steps.map((step, i) => (
          <Fragment key={`${step.label}-${i}`}>
            {i > 0 && <span className="lane-arrow" aria-hidden="true">→</span>}
            <span className={`lane-step ${step.tone}`}>{step.label}</span>
          </Fragment>
        ))}
      </div>
      <div className="lane-metrics">
        {lane.tokens != null && <span className="mono">{fmtTokens(lane.tokens)}</span>}
        {lane.durationSec != null && <span>{fmtDuration(lane.durationSec)}</span>}
      </div>
      <div className="lane-bar" aria-hidden="true">
        <i style={{ width: lane.percent != null ? `${Math.min(100, Math.max(0, lane.percent))}%` : '100%' }} />
      </div>
    </div>
  );
}
