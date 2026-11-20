import { Anchor, RefreshCw, Webhook } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Spinner } from '../design-system/Spinner';
import type { HooksViewProps } from '@/contracts/hooks';
import kit from '../settings/SettingsPage.module.css';

/**
 * HooksView —— 钩子分区（纯展示）。
 *
 * 视觉走设置页套件（SettingsPage.module.css）：工具栏（计数 + 刷新）→
 * 圆角行列表（图标瓦片 + 名称/状态徽标 + 摘要 + 开关）→ 事件分节。
 * 测试锚点（hook-row-* / hook-toggle-* / hooks-*）全部保留。
 */
export function HooksView({ t, hooks, loading, error, pendingName, eventsOpen, eventsLoading, events, onToggle, onRefresh, onEventsToggle }: HooksViewProps) {
  const enabledCount = hooks.filter((h) => h.enabled).length;
  return (
    <PageShell icon={Webhook} title={t('hooks.title')} subtitle={t('hooks.subtitle')} width="lg">
      <div className={kit.toolbar}>
        <span className={kit.countChip}>
          {t('hooks.enabledCount', { enabled: enabledCount, total: hooks.length })}
        </span>
        <span className={kit.grow} />
        <button
          type="button"
          className={kit.btn}
          onClick={onRefresh}
          disabled={loading || pendingName !== null}
          data-testid="hooks-refresh"
        >
          <RefreshCw strokeWidth={1.5} aria-hidden /> {t('git.refresh')}
        </button>
      </div>

      {loading && <div className={kit.emptyBox}><Spinner size={14} /> {t('common.loading')}</div>}
      {!loading && error && <div className={kit.notice}><span>{t('hooks.loadFailed')}：{error}</span></div>}
      {!loading && !error && hooks.length === 0 && (
        <div className={kit.emptyBox}>{t('hooks.empty')} —— {t('hooks.emptyDesc')}</div>
      )}

      {!loading && hooks.length > 0 && (
        <div className={kit.resGroup}>
          <div className={kit.resList}>
            {hooks.map((hook) => (
              <div key={hook.name} className={kit.resItem} data-testid={`hook-row-${hook.name}`}>
                <span className={kit.iconTile}><Anchor strokeWidth={1.5} aria-hidden /></span>
                <div className={kit.resMain}>
                  <div className={kit.titleRow}>
                    <code className={`${kit.resTitle} ${kit.mono}`}>{hook.name}</code>
                    <span className={kit.badge}>{hook.kind}</span>
                    <span className={kit.badge} data-fg={hook.enabled || undefined}>
                      {hook.enabled ? t('hooks.on') : t('hooks.off')}
                    </span>
                  </div>
                  <div className={kit.resDesc}>{hook.config_summary}</div>
                </div>
                <div className={kit.resSide}>
                  <input
                    type="checkbox"
                    className={kit.checkbox}
                    checked={hook.enabled}
                    disabled={pendingName !== null}
                    onChange={() => onToggle(hook)}
                    aria-label={`${hook.enabled ? t('hooks.disable') : t('hooks.enable')}: ${hook.name}`}
                    data-testid={`hook-toggle-${hook.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={kit.resGroup} data-testid="hooks-events-panel">
        <button
          type="button"
          className={`${kit.btn} ${kit.ghost}`}
          onClick={onEventsToggle}
          aria-expanded={eventsOpen}
          data-testid="hooks-events-toggle"
        >
          {eventsOpen ? '▾' : '▸'} {t('hooks.events.title')}
        </button>
        {eventsOpen && (
          eventsLoading ? (
            <div className={kit.emptyBox}><Spinner size={14} /> {t('common.loading')}</div>
          ) : (
            <div className={kit.resList} data-testid="hooks-events-list">
              {events.map((e) => (
                <div key={e.kind} className={kit.resItem}>
                  <span className={kit.iconTile}><Anchor strokeWidth={1.5} aria-hidden /></span>
                  <div className={kit.resMain}>
                    <div className={`${kit.resTitle} ${kit.mono}`}>{e.kind}</div>
                    <div className={kit.resDesc}>{e.description}</div>
                  </div>
                  <div className={` `}>
                    {e.decisions.length === 0 && <span className={kit.badge}>{t('hooks.events.notificationOnly')}</span>}
                    {e.decisions.map((d) => <span key={d} className={kit.badge}>{d}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </PageShell>
  );
}
