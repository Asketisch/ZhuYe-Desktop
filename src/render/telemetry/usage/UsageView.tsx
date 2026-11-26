/**
 * Usage —— 模型级 token 用量纯展示视图。
 */
import { Gauge } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ModelUsage, UsageViewProps } from '@/contracts/telemetry/usage';
import { PageShell } from '@/render/harness/shell/PageShell';
import kit from '@/render/harness/settings/SettingsPage.module.css';
import s from './UsageView.module.css';

const ICONS: Record<string, ComponentType> = { gauge: Gauge };

function fmtNum(n: number): string { return n.toLocaleString(); }
function fmtCost(v: number | null | undefined): string { return v == null ? '—' : `$${v.toFixed(4)}`; }
// 命中率是比例,钳到 [0, 100%](上游口径漂移时不至于显示 > 100%)。
// 渲染层不依赖逻辑层,此处就地钳制。
function fmtRate(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(Math.min(1, Math.max(0, v)) * 100).toFixed(1)}%`;
}
function fmtPrice(v: number | null | undefined): string { return v == null ? '—' : `$${v.toFixed(2)}`; }

export function UsageView({
  title, subtitle, width, iconName, sessionId, stats, statsError, models, modelsLoading,
  modelsError, live, rateCards, dailyActivity, onRefresh, labels,
}: UsageViewProps) {
  return (
    <PageShell icon={ICONS[iconName]} title={title} subtitle={subtitle} width={width}
      actions={<button type="button" className={kit.btn} onClick={onRefresh}>{labels.refresh}</button>}>
      <section className={s.section} aria-label={labels.currentSession}>
        <h3 className={s.sectionTitle}>{labels.currentSession}</h3>
        {!sessionId ? (
          <div className={kit.emptyBox}>{labels.noSession} —— {labels.noSessionHint}</div>
        ) : statsError ? (
          <div className={kit.notice}><span>{statsError}</span></div>
        ) : !stats ? (
          <div className={kit.emptyBox}>{labels.noStats} —— {labels.emptyHint}</div>
        ) : (
          <>
            <div className={s.statGrid} data-testid="usage-session-stats">
              <Stat label={labels.model} value={stats.model} />
              <Stat label={labels.messages} value={fmtNum(stats.messageCount)} />
              <Stat label={labels.toolCalls} value={fmtNum(stats.toolCalls)} />
              <Stat label={labels.input} value={fmtNum(stats.inputTokens)} />
              <Stat label={labels.output} value={fmtNum(stats.outputTokens)} />
              <Stat label={labels.cached} value={fmtNum(stats.cachedTokens)} />
              <Stat label={labels.total} value={fmtNum(stats.totalTokens)} />
              <Stat label={labels.cost} value={fmtCost(stats.costUsd)} />
              <Stat label={labels.cacheHitRate} value={fmtRate(stats.cacheHitRate)} />
              <Stat label={labels.tokensSaved} value={`${fmtNum(stats.compactions)} · ${fmtNum(stats.compactionTokensSaved)}`} />
              <Stat label={labels.memoryAccess} value={`${fmtNum(stats.memoryReads)} / ${fmtNum(stats.memoryWrites)}`} />
            </div>
            {stats.perModel.length > 0 && (
              <>
                <h4 className={s.sectionTitle}>{labels.perModel}</h4>
                <ModelTable models={stats.perModel} labels={labels} />
              </>
            )}
          </>
        )}
      </section>

      <section className={s.section} aria-label={labels.heatmap}>
        <h3 className={s.sectionTitle}>{labels.heatmap}</h3>
        <p className={s.hint}>{labels.heatmapHint}</p>
        {dailyActivity.length === 0 ? (
          <div className={kit.emptyBox}>{labels.liveEmpty}</div>
        ) : (
          <div className={s.tableWrap} data-testid="usage-heatmap">
            <Heatmap daily={dailyActivity} />
          </div>
        )}
      </section>

      <section className={s.section} aria-label={labels.perModel}>
        <h3 className={s.sectionTitle}>{labels.perModel}</h3>
        {modelsError ? (
          <div className={kit.notice}><span>{modelsError}</span></div>
        ) : models.length === 0 && !modelsLoading ? (
          <div className={kit.emptyBox}>{labels.empty} —— {labels.emptyHint}</div>
        ) : (
          <ModelBars models={models} labels={labels} />
        )}
      </section>

      <section className={s.section} aria-label={labels.live}>
        <h3 className={s.sectionTitle}>{labels.live}</h3>
        <p className={s.hint}>{labels.liveHint}</p>
        {live.length === 0 ? (
          <div className={kit.emptyBox}>{labels.liveEmpty} —— {labels.liveEmptyHint}</div>
        ) : (
          <div className={s.tableWrap} data-testid="usage-live-table">
            <table className={s.table}>
              <thead><tr><th>{labels.model}</th><th className={s.num}>{labels.calls}</th><th className={s.num}>{labels.input}</th><th className={s.num}>{labels.output}</th><th className={s.num}>{labels.cached}</th><th className={s.num}>{labels.total}</th><th className={s.num}>{labels.cost}</th></tr></thead>
              <tbody>{live.map((m) => (
                <tr key={m.model}><td className={s.model}>{m.model}</td><td className={s.num}>{fmtNum(m.calls)}</td><td className={s.num}>{fmtNum(m.input)}</td><td className={s.num}>{fmtNum(m.output)}</td><td className={s.num}>{fmtNum(m.cached)}</td><td className={s.num}>{fmtNum(m.total)}</td><td className={s.num}>{fmtCost(m.cost)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-label={labels.rates}>
        <h3 className={s.sectionTitle}>{labels.rates}</h3>
        <p className={s.hint}>{labels.ratesHint}</p>
        <RateCardTable cards={rateCards} labels={labels} />
      </section>

      <section className={s.section} aria-label={labels.empty}>
        <h3 className={s.sectionTitle}>{labels.empty}</h3>
        {modelsError ? (
          <div className={kit.notice}><span>{modelsError}</span></div>
        ) : (
          <details className={s.details}>
            <summary>{labels.perModel}</summary>
            <ModelTable models={models} labels={labels} testId="usage-model-details" />
          </details>
        )}
      </section>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.statCard}>
      <div className={s.statHead}><span>{label}</span></div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}

/** 近 91 天会话活动热力：列 = 周、行 = weekday（周一在首行），5 档强度。 */
function Heatmap({ daily }: { daily: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));
  return (
    <div className={s.heatGrid} role="img" aria-label="activity heatmap">
      {daily.map((d) => (
        <div
          key={d.date}
          className={s.heatCell}
          data-level={level(d.count)}
          title={`${d.date} · ${d.count}`}
        />
      ))}
    </div>
  );
}

/** 模型占比条：按总 token 降序，宽度 = 占最大模型的相对比例。 */
function ModelBars({ models, labels }: { models: ModelUsage[]; labels: UsageViewProps['labels'] }) {
  const sorted = [...models].sort((a, b) => b.totalTokens - a.totalTokens);
  const max = Math.max(1, ...sorted.map((m) => m.totalTokens));
  return (
    <div className={s.barList}>
      {sorted.map((m) => (
        <div key={m.model} className={s.barRow} data-testid="usage-model-bars">
          <div className={s.barMain}>
            <div className={s.barLabel}>
              <span className={s.barName}>{m.model}</span>
              <span className={s.barValue}>
                {fmtNum(m.totalTokens)} tok · {fmtNum(m.calls)} {labels.calls} · {fmtCost(m.costUsd)}
              </span>
            </div>
            <div className={s.barTrack}>
              <div className={s.barFill} style={{ width: `${Math.round((m.totalTokens / max) * 100)}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelTable({ models, labels, testId = 'usage-model-table' }: { models: ModelUsage[]; labels: UsageViewProps['labels']; testId?: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} data-testid={testId}>
        <thead><tr><th>{labels.model}</th><th>{labels.provider}</th><th className={s.num}>{labels.calls}</th><th className={s.num}>{labels.input}</th><th className={s.num}>{labels.output}</th><th className={s.num}>{labels.total}</th><th className={s.num}>{labels.cost}</th></tr></thead>
        <tbody>{models.map((m) => (
          <tr key={m.model}><td className={s.model}>{m.model}</td><td>{m.provider ?? '—'}</td><td className={s.num}>{fmtNum(m.calls)}</td><td className={s.num}>{fmtNum(m.inputTokens)}</td><td className={s.num}>{fmtNum(m.outputTokens)}</td><td className={s.num}>{fmtNum(m.totalTokens)}</td><td className={s.num}>{fmtCost(m.costUsd)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function RateCardTable({ cards, labels }: { cards: UsageViewProps['rateCards']; labels: UsageViewProps['labels'] }) {
  if (cards.length === 0) return null;
  return (
    <div className={s.tableWrap}>
      <table className={s.table} data-testid="usage-rate-card-table">
        <thead><tr><th>{labels.model}</th><th className={s.num}>{labels.rateInput}</th><th className={s.num}>{labels.rateOutput}</th><th className={s.num}>{labels.rateCacheRead}</th><th className={s.num}>{labels.rateCacheWrite}</th></tr></thead>
        <tbody>{cards.map((c) => (
          <tr key={c.model}><td className={s.model}>{c.model}</td>
            {c.priced ? (
              <>
                <td className={s.num}>{fmtPrice(c.inputPrice)}</td><td className={s.num}>{fmtPrice(c.outputPrice)}</td>
                <td className={s.num}>{fmtPrice(c.cacheReadPrice)}</td><td className={s.num}>{fmtPrice(c.cacheWritePrice)}</td>
              </>
            ) : <td colSpan={4} className={s.notPriced}>{labels.notPriced}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
