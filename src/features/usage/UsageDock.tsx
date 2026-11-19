/**
 * UsageDock —— 右 dock「用量」面板（harness 单色设计）。
 *
 * 结构对应 harness.css `.usg` 块：顶栏（标题 + #短id · 会话标题 + 刷新）
 * + 卡片列：本会话总量（大数字 + token 三分段堆叠条）/ 跨会话成本对比
 * （top 8,当前会话 `.top` 高亮）/ 工具调用统计 / 模型费率。
 *
 * 数据面在 `@/logic/usage/useUsageDock`（选型与口径见该文件注释）。
 */
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import { useUsageDock, buildSegments, formatUsd, type UsageDockSegment } from '@/logic/usage/useUsageDock';

/** 单色系分段填充与图例文案（仅用设计 token,无硬编码色）。 */
const SEGMENT_COLOR: Record<UsageDockSegment['key'], string> = {
  cached: 'var(--fg-3)',
  fresh: 'var(--fg-2)',
  output: 'var(--fg)',
};

/** 会话短 id（侧栏同款口径:uuid 前 8 位）。 */
function shortId(id: string | null): string | null {
  return id ? id.slice(0, 8) : null;
}

/** 跨会话成本对比卡：top 8 行,当前会话 `.top` 高亮。 */
function CostCard({ rows }: { rows: ReturnType<typeof useUsageDock>['costRows'] }) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <div className="us-empty">{t('harness.usage.crossEmpty')}</div>;
  }
  const max = Math.max(...rows.map((r) => r.costUsd));
  return (
    <div className="us-list">
      {rows.map((row) => (
        <div className="us-row" key={row.sessionId} data-current={row.current || undefined}>
          <span className="n" title={row.title ?? row.sessionId}>
            {row.title ?? `#${(row.sessionId.slice(0, 8))}`}
          </span>
          <span className="us-track">
            <i
              className={row.current ? 'top' : undefined}
              style={{ width: `${max > 0 ? Math.max(4, (row.costUsd / max) * 100) : 4}%` }}
            />
          </span>
          <span className="v">{formatUsd(row.costUsd)}</span>
        </div>
      ))}
    </div>
  );
}

/** 工具调用统计卡（SessionStats 无 toolCalls 时整卡省略）。 */
function ToolStatsCard({ stats }: { stats: NonNullable<ReturnType<typeof useUsageDock>['stats']> }) {
  const { t } = useI18n();
  if (typeof stats.toolCalls !== 'number') return null;
  return (
    <div className="us-card">
      <div className="us-kv">
        <span>{t('harness.usage.toolCalls')}</span>
        <b>{stats.toolCalls.toLocaleString()}</b>
      </div>
      {stats.compactions > 0 && (
        <div className="us-kv">
          <span>{t('harness.usage.compactions')}</span>
          <b>{stats.compactions.toLocaleString()}</b>
        </div>
      )}
      {stats.compactionTokensSaved > 0 && (
        <div className="us-kv">
          <span>{t('harness.usage.compSaved')}</span>
          <b>{stats.compactionTokensSaved.toLocaleString()}</b>
        </div>
      )}
    </div>
  );
}

/** 模型费率卡：每 1M token 单价;不在费率表的模型标注「未定价」。 */
function RateCardRow({ card }: { card: { model: string; priced: boolean; inputPrice?: number | null; outputPrice?: number | null } }) {
  const { t } = useI18n();
  const price =
    card.priced && typeof card.inputPrice === 'number' && typeof card.outputPrice === 'number'
      ? t('harness.usage.ratesIn', { in: `$${card.inputPrice.toFixed(2)}`, out: `$${card.outputPrice.toFixed(2)}` })
      : t('harness.usage.unpriced');
  return (
    <div className="us-row" title={card.model}>
      <span className="n">{card.model}</span>
      <span className="v">{price}</span>
    </div>
  );
}

export function UsageDock() {
  const { t } = useI18n();
  const { activeId, sessionTitle, stats, costRows, rateCards, refresh } = useUsageDock();
  const sid = shortId(activeId);
  const sub = sid ? (sessionTitle ? `#${sid} · ${sessionTitle}` : `#${sid}`) : null;
  // 分段图例文案（t 依赖 i18n 上下文,在组件体内构建）。
  const SEGMENT_LABEL: Record<UsageDockSegment['key'], string> = {
    cached: t('harness.usage.cached'),
    fresh: t('harness.usage.fresh'),
    output: t('harness.usage.output'),
  };

  // token 三分段（缓存命中 / 新输入 / 模型输出;纯函数,总零 → 空数组）。
  const segments = buildSegments(stats);

  return (
    <div className="usg" data-testid="usage-dock">
      <div className="us-bar">
        <span className="us-title">{t('harness.usage.title')}</span>
        <span className="us-sub">{sub ?? t('harness.usage.noSession')}</span>
        <span className="tp-spacer" />
        <button
          type="button"
          className="tb-btn"
          title={t('harness.usage.refresh')}
          aria-label={t('harness.usage.refresh')}
          onClick={refresh}
          data-testid="usage-dock-refresh"
        >
          <RefreshCw size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="us-body">
        {!activeId && <div className="us-empty">{t('harness.usage.noSession')}</div>}
        {activeId && (
          <>
            {/* 本会话总量 */}
            <section>
              <div className="us-h">{t('harness.usage.total')}</div>
              <div className="us-card">
                {stats ? (
                  <>
                    <div className="us-total">
                      <b data-testid="usage-dock-total">{(stats.totalTokens ?? 0).toLocaleString()}</b>
                      <span>{t('harness.usage.msgs', { n: stats.messageCount ?? 0 })}</span>
                    </div>
                    {segments.length > 0 && (
                      <>
                        <div className="us-split" role="img" aria-label={t('harness.usage.total')}>
                          {segments.map((seg) => (
                            <i
                              key={seg.key}
                              style={{ width: `${Math.max(2, seg.share * 100)}%`, background: SEGMENT_COLOR[seg.key] }}
                            />
                          ))}
                        </div>
                        <div className="us-legend">
                          {segments.map((seg) => (
                            <div className="us-line" key={seg.key}>
                              <i style={{ background: SEGMENT_COLOR[seg.key] }} />
                              <span>{SEGMENT_LABEL[seg.key]}</span>
                              <b>{seg.value.toLocaleString()}</b>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="us-empty">{t('harness.usage.statsEmpty')}</div>
                )}
              </div>
            </section>

            {/* 跨会话成本对比 */}
            <section>
              <div className="us-h">{t('harness.usage.cross')}</div>
              <div className="us-card">
                <CostCard rows={costRows} />
              </div>
            </section>

            {/* 工具调用统计（stats 存在且带 toolCalls 才渲染） */}
            {stats && (
              <section>
                <div className="us-h">{t('harness.usage.tools')}</div>
                <ToolStatsCard stats={stats} />
              </section>
            )}

            {/* 模型费率（有小卡可选,查询无果则整段省略） */}
            {rateCards.length > 0 && (
              <section>
                <div className="us-h">{t('harness.usage.rates')}</div>
                <div className="us-card">
                  <div className="us-list">
                    {rateCards.map((card) => (
                      <RateCardRow key={card.model} card={card} />
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
