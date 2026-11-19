/**
 * 市场页纯展示组件 —— 消费 harness.css 全局类(monochrome 设计),
 * 不携带任何状态与 IPC 逻辑。
 */
import { ArrowLeft, Blocks, Plug, Puzzle } from 'lucide-react';
import type { ComponentType } from 'react';
import type { MarketCard, MarketLocaleKey, MarketViewProps } from '@/contracts/market';

/** 分类 → 图标字形。 */
const GLYPH_ICON: Record<MarketCard['glyph'], ComponentType<{ size?: number; strokeWidth?: number }>> = {
  mcp: Plug,
  plugin: Puzzle,
  skill: Blocks,
};

/** 过滤 seg 四档。 */
const FILTERS: Array<{ id: 'all' | 'mcp' | 'skill' | 'hook'; key: MarketLocaleKey }> = [
  { id: 'all', key: 'harness.market.all' },
  { id: 'mcp', key: 'harness.market.filterMcp' },
  { id: 'skill', key: 'harness.market.filterSkill' },
  { id: 'hook', key: 'harness.market.filterHook' },
];

export function MarketView({
  t, query, filter, cards, installedCount, availableCount, loading, busyId,
  onQueryChange, onFilterChange, onBack, onAction, onSecondary,
}: MarketViewProps) {
  return (
    <div className="market" data-testid="market-view">
      <header className="market-head">
        <button type="button" className="tb-btn" aria-label={t('harness.market.back')} onClick={onBack} data-testid="market-back">
          <ArrowLeft size={14} strokeWidth={1.75} />
        </button>
        <div>
          <div className="market-title">{t('harness.market.title')}</div>
          <div className="market-sub">
            {loading
              ? t('harness.market.loading')
              : t('harness.market.installedOf', { installed: installedCount, available: availableCount })}
          </div>
        </div>
        <div className="market-tools">
          <input
            className="market-search"
            value={query}
            placeholder={t('harness.market.search')}
            onChange={(e) => onQueryChange(e.target.value)}
            data-testid="market-search"
          />
          <div className="seg" role="group" aria-label={t('harness.market.all')}>
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === filter ? 'on' : ''}
                onClick={() => onFilterChange(option.id)}
                data-testid={`market-filter-${option.id}`}
              >
                {t(option.key)}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="market-body">
        {cards.length === 0 ? (
          <div className="mk-empty">{loading ? t('harness.market.loading') : t('harness.market.empty')}</div>
        ) : (
          <div className="mk-grid">
            {cards.map((card) => (
              <MarketCardView
                key={card.id}
                t={t}
                card={card}
                busy={busyId === card.id}
                onAction={onAction}
                onSecondary={onSecondary}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单张市场卡。 */
function MarketCardView({
  t, card, busy, onAction, onSecondary,
}: {
  t: MarketViewProps['t'];
  card: MarketCard;
  busy: boolean;
  onAction: MarketViewProps['onAction'];
  onSecondary: MarketViewProps['onSecondary'];
}) {
  const Icon = GLYPH_ICON[card.glyph];
  return (
    <article className="mk-card" data-testid={`market-card-${card.id}`}>
      <div className="mk-top">
        <span className="mk-ico" aria-hidden="true">
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <div>
          <div className="mk-name">{card.name}</div>
          <div className="mk-src">{card.src}</div>
        </div>
        {card.installed && (
          <span className="mk-badge on">{t('harness.market.installed')}</span>
        )}
      </div>
      <p className="mk-desc">
        {card.desc}
        {card.toolCount != null ? ` · ${t('harness.market.toolCount', { n: card.toolCount })}` : ''}
      </p>
      <div className="mk-perm">
        <span className="mk-perm-t">{t('harness.market.perms')}</span>
        {card.perms.map((perm) => (
          <span key={perm.key} className={`mk-perm-row ${perm.tone === 'local' ? '' : perm.tone}`}>
            <i />
            {t(perm.key)}
          </span>
        ))}
      </div>
      <div className="mk-foot">
        <span className="ver">{card.version ?? '—'}</span>
        {card.secondary === 'uninstall' && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onSecondary(card)}
            data-testid={`market-action-${card.id}-uninstall`}
          >
            {t('harness.market.uninstall')}
          </button>
        )}
        {card.action && (
          <button
            type="button"
            className={`btn${card.action === 'install' ? ' primary' : ''}`}
            disabled={busy}
            onClick={() => onAction(card)}
            data-testid={`market-action-${card.id}`}
          >
            {card.action === 'install'
              ? t('harness.market.install')
              : card.action === 'uninstall'
                ? t('harness.market.uninstall')
                : card.action === 'enable'
                  ? t('harness.market.enable')
                  : t('harness.market.disable')}
          </button>
        )}
      </div>
    </article>
  );
}
