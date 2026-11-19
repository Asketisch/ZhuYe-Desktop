/**
 * Usage —— 模型级 token 用量纯展示视图。
 */
import { Gauge } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ModelUsage, UsageViewProps } from '@/contracts/usage';
import { PageShell } from '../shell/PageShell';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import s from './UsageView.module.css';

const ICONS: Record<string, ComponentType> = { gauge: Gauge };

function fmtNum(n: number): string { return n.toLocaleString(); }
function fmtCost(v: number | null | undefined): string { return v == null ? '—' : `$${v.toFixed(4)}`; }
function fmtRate(v: number | null | undefined): string { return v == null ? '—' : `${(v * 100).toFixed(1)}%`; }
function fmtPrice(v: number | null | undefined): string { return v == null ? '—' : `$${v.toFixed(2)}`; }

export function UsageView({
  title, subtitle, width, iconName, sessionId, stats, statsError, models, modelsLoading,
  modelsError, live, rateCards, onRefresh, labels,
}: UsageViewProps) {
  return (
    <PageShell icon={ICONS[iconName]} title={title} subtitle={subtitle} width={width}
      actions={<Button size="sm" variant="ghost" onClick={onRefresh}>{labels.refresh}</Button>}>
      <section className={s.section} aria-label={labels.currentSession}>
        <h3 className={s.sectionTitle}>{labels.currentSession}</h3>
        {!sessionId ? (
          <Card level="flat" padding="none"><EmptyState size="sm" icon={<Icon icon={Gauge} />} title={labels.noSession} description={labels.noSessionHint} /></Card>
        ) : statsError ? (
          <Card level="flat" padding="sm"><p className={s.error}>{statsError}</p></Card>
        ) : !stats ? (
          <Card level="flat" padding="none"><EmptyState size="sm" icon={<Icon icon={Gauge} />} title={labels.noStats} description={labels.emptyHint} /></Card>
        ) : (
          <>
            <div className={s.stats} data-testid="usage-session-stats">
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

      <section className={s.section} aria-label={labels.live}>
        <h3 className={s.sectionTitle}>{labels.live}</h3>
        <p className={s.hint}>{labels.liveHint}</p>
        {live.length === 0 ? (
          <Card level="flat" padding="none"><EmptyState size="sm" icon={<Icon icon={Gauge} />} title={labels.liveEmpty} description={labels.liveEmptyHint} /></Card>
        ) : (
          <div data-testid="usage-live-table">
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
          <Card level="flat" padding="sm"><p className={s.error}>{modelsError}</p></Card>
        ) : models.length === 0 && !modelsLoading ? (
          <Card level="flat" padding="none"><EmptyState size="sm" icon={<Icon icon={Gauge} />} title={labels.empty} description={labels.emptyHint} /></Card>
        ) : <ModelTable models={models} labels={labels} />}
      </section>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className={s.stat}><span className={s.statLabel}>{label}</span><span className={s.statValue}>{value}</span></div>;
}

function ModelTable({ models, labels }: { models: ModelUsage[]; labels: UsageViewProps['labels'] }) {
  return (
    <table className={s.table} data-testid="usage-model-table">
      <thead><tr><th>{labels.model}</th><th>{labels.provider}</th><th className={s.num}>{labels.calls}</th><th className={s.num}>{labels.input}</th><th className={s.num}>{labels.output}</th><th className={s.num}>{labels.total}</th><th className={s.num}>{labels.cost}</th></tr></thead>
      <tbody>{models.map((m) => (
        <tr key={m.model}><td className={s.model}>{m.model}</td><td>{m.provider ?? '—'}</td><td className={s.num}>{fmtNum(m.calls)}</td><td className={s.num}>{fmtNum(m.inputTokens)}</td><td className={s.num}>{fmtNum(m.outputTokens)}</td><td className={s.num}>{fmtNum(m.totalTokens)}</td><td className={s.num}>{fmtCost(m.costUsd)}</td></tr>
      ))}</tbody>
    </table>
  );
}

function RateCardTable({ cards, labels }: { cards: UsageViewProps['rateCards']; labels: UsageViewProps['labels'] }) {
  if (cards.length === 0) return null;
  return (
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
  );
}
