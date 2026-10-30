/**
 * Usage —— 模型级 token 用量视图。
 *
 * 数据源是 rollout JSONL(`~/.zhuye/sessions/`)的落盘聚合,与 CLI
 * `reflect session stats` 同源(后端复用 `reflect-rollout` 的统计实现,
 * 不在桌面端复刻 token 聚合)。
 *
 * 两个区块:
 * - **当前会话**:token 用量 / 缓存命中率 / 压缩节省 / 记忆访问 + 按模型拆分;
 * - **全部会话**:跨会话合计的按模型用量。
 */
import { Gauge } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Button, Card, EmptyState, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import type { ModelUsage, RateCard } from '@/utils/commands/stats';
import { useUsageController } from './useUsageController';
import s from './UsageView.module.css';

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtCost(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toFixed(4)}`;
}

function fmtRate(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function fmtPrice(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toFixed(2)}`;
}

/** 按模型拆分的用量表。 */
function ModelTable({ models }: { models: ModelUsage[] }) {
  const { t } = useI18n();
  return (
    <table className={s.table} data-testid="usage-model-table">
      <thead>
        <tr>
          <th>{t('usage.model')}</th>
          <th>{t('usage.provider')}</th>
          <th className={s.num}>{t('usage.calls')}</th>
          <th className={s.num}>{t('usage.input')}</th>
          <th className={s.num}>{t('usage.output')}</th>
          <th className={s.num}>{t('usage.total')}</th>
          <th className={s.num}>{t('usage.cost')}</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr key={m.model}>
            <td className={s.model}>{m.model}</td>
            <td>{m.provider ?? '—'}</td>
            <td className={s.num}>{fmtNum(m.calls)}</td>
            <td className={s.num}>{fmtNum(m.inputTokens)}</td>
            <td className={s.num}>{fmtNum(m.outputTokens)}</td>
            <td className={s.num}>{fmtNum(m.totalTokens)}</td>
            <td className={s.num}>{fmtCost(m.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 费率卡 —— 让费用可解释。
 *
 * 单价来自核心的静态费率表(桌面端读取侧反解,`app_core::pricing`),
 * 因此「输入 $x / 1M、输出 $y / 1M」与引擎计费用的是同一份表。
 */
function RateCardTable({ cards }: { cards: RateCard[] }) {
  const { t } = useI18n();
  if (cards.length === 0) return null;
  return (
    <table className={s.table} data-testid="usage-rate-card-table">
      <thead>
        <tr>
          <th>{t('usage.model')}</th>
          <th className={s.num}>{t('usage.rateInput')}</th>
          <th className={s.num}>{t('usage.rateOutput')}</th>
          <th className={s.num}>{t('usage.rateCacheRead')}</th>
          <th className={s.num}>{t('usage.rateCacheWrite')}</th>
        </tr>
      </thead>
      <tbody>
        {cards.map((c) => (
          <tr key={c.model}>
            <td className={s.model}>{c.model}</td>
            {c.priced ? (
              <>
                <td className={s.num}>{fmtPrice(c.inputPrice)}</td>
                <td className={s.num}>{fmtPrice(c.outputPrice)}</td>
                <td className={s.num}>{fmtPrice(c.cacheReadPrice)}</td>
                <td className={s.num}>{fmtPrice(c.cacheWritePrice)}</td>
              </>
            ) : (
              <td colSpan={4} className={s.notPriced}>
                {t('usage.notPriced')}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageView() {
  const { t } = useI18n();
  const c = useUsageController();

  return (
    <PageShell
      icon={Gauge}
      title={t('usage.title')}
      subtitle={t('usage.subtitle')}
      width="lg"
      actions={<Button size="sm" variant="ghost" onClick={c.refresh}>{t('usage.refresh')}</Button>}
    >
      <section className={s.section} aria-label={t('usage.currentSession')}>
        <h3 className={s.sectionTitle}>{t('usage.currentSession')}</h3>
        {!c.sessionId ? (
          <Card level="flat" padding="none">
            <EmptyState
              size="sm"
              icon={<Icon icon={Gauge} />}
              title={t('usage.noSession')}
              description={t('usage.noSessionHint')}
            />
          </Card>
        ) : c.statsError ? (
          <Card level="flat" padding="sm">
            <p className={s.error}>{c.statsError}</p>
          </Card>
        ) : !c.stats ? (
          <Card level="flat" padding="none">
            <EmptyState
              size="sm"
              icon={<Icon icon={Gauge} />}
              title={t('usage.noStats')}
              description={t('usage.emptyHint')}
            />
          </Card>
        ) : (
          <>
            <div className={s.stats} data-testid="usage-session-stats">
              <Stat label={t('usage.model')} value={c.stats.model} />
              <Stat label={t('usage.messages')} value={fmtNum(c.stats.messageCount)} />
              <Stat label={t('usage.toolCalls')} value={fmtNum(c.stats.toolCalls)} />
              <Stat label={t('usage.input')} value={fmtNum(c.stats.inputTokens)} />
              <Stat label={t('usage.output')} value={fmtNum(c.stats.outputTokens)} />
              <Stat label={t('usage.cached')} value={fmtNum(c.stats.cachedTokens)} />
              <Stat label={t('usage.total')} value={fmtNum(c.stats.totalTokens)} />
              <Stat label={t('usage.cost')} value={fmtCost(c.stats.costUsd)} />
              <Stat label={t('usage.cacheHitRate')} value={fmtRate(c.stats.cacheHitRate)} />
              <Stat
                label={t('usage.tokensSaved')}
                value={`${fmtNum(c.stats.compactions)} · ${fmtNum(c.stats.compactionTokensSaved)}`}
              />
              <Stat
                label={t('usage.memoryAccess')}
                value={`${fmtNum(c.stats.memoryReads)} / ${fmtNum(c.stats.memoryWrites)}`}
              />
            </div>
            {c.stats.perModel.length > 0 && (
              <>
                <h4 className={s.sectionTitle}>{t('usage.perModel')}</h4>
                <ModelTable models={c.stats.perModel} />
              </>
            )}
          </>
        )}
      </section>

      <section className={s.section} aria-label={t('usage.live')}>
        <h3 className={s.sectionTitle}>{t('usage.live')}</h3>
        <p className={s.hint}>{t('usage.liveHint')}</p>
        {c.live.length === 0 ? (
          <Card level="flat" padding="none">
            <EmptyState
              size="sm"
              icon={<Icon icon={Gauge} />}
              title={t('usage.liveEmpty')}
              description={t('usage.liveEmptyHint')}
            />
          </Card>
        ) : (
          <div data-testid="usage-live-table">
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t('usage.model')}</th>
                  <th className={s.num}>{t('usage.calls')}</th>
                  <th className={s.num}>{t('usage.input')}</th>
                  <th className={s.num}>{t('usage.output')}</th>
                  <th className={s.num}>{t('usage.cached')}</th>
                  <th className={s.num}>{t('usage.total')}</th>
                  <th className={s.num}>{t('usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {c.live.map((m) => (
                  <tr key={m.model}>
                    <td className={s.model}>{m.model}</td>
                    <td className={s.num}>{fmtNum(m.calls)}</td>
                    <td className={s.num}>{fmtNum(m.input)}</td>
                    <td className={s.num}>{fmtNum(m.output)}</td>
                    <td className={s.num}>{fmtNum(m.cached)}</td>
                    <td className={s.num}>{fmtNum(m.total)}</td>
                    <td className={s.num}>{fmtCost(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-label={t('usage.rates')}>
        <h3 className={s.sectionTitle}>{t('usage.rates')}</h3>
        <p className={s.hint}>{t('usage.ratesHint')}</p>
        <RateCardTable cards={c.rateCards} />
      </section>

      <section className={s.section} aria-label={t('usage.allSessions')}>
        <h3 className={s.sectionTitle}>{t('usage.allSessions')}</h3>
        {c.modelsError ? (
          <Card level="flat" padding="sm">
            <p className={s.error}>{c.modelsError}</p>
          </Card>
        ) : c.models.length === 0 && !c.modelsLoading ? (
          <Card level="flat" padding="none">
            <EmptyState
              size="sm"
              icon={<Icon icon={Gauge} />}
              title={t('usage.empty')}
              description={t('usage.emptyHint')}
            />
          </Card>
        ) : (
          <ModelTable models={c.models} />
        )}
      </section>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
    </div>
  );
}
