import { Webhook, RefreshCw } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import { EmptyState } from '../design-system/EmptyState';
import { Button } from '../design-system/Button';
import type { HooksViewProps } from '@/contracts/hooks';
import s from './HooksView.module.css';

export function HooksView({ t, hooks, loading, error, pendingName, eventsOpen, eventsLoading, events, onToggle, onRefresh, onEventsToggle }: HooksViewProps) {
  return (
    <PageShell icon={Webhook} title={t('hooks.title')} subtitle={t('hooks.subtitle')} width="lg">
      <div className={s.toolbar}>
        <span className={s.summary}>{t('hooks.enabledCount', { enabled: hooks.filter((h) => h.enabled).length, total: hooks.length })}</span>
        <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading || pendingName !== null} leftIcon={<Icon icon={RefreshCw} size={13} />} data-testid="hooks-refresh">{t('git.refresh')}</Button>
      </div>
      {loading && <Card level="flat" padding="lg"><div className={s.center}><Spinner size={14} /> {t('common.loading')}</div></Card>}
      {!loading && error && <Card level="flat" padding="lg"><EmptyState icon={<Icon icon={Webhook} size={20} />} title={t('hooks.loadFailed')} description={error} /></Card>}
      {!loading && !error && hooks.length === 0 && <Card level="flat" padding="lg"><EmptyState icon={<Icon icon={Webhook} size={20} />} title={t('hooks.empty')} description={t('hooks.emptyDesc')} /></Card>}
      {!loading && hooks.length > 0 && (
        <Card level="flat" padding="none"><ul className={s.list}>{hooks.map((hook) => (
          <li key={hook.name} className={s.row} data-testid={`hook-row-${hook.name}`}>
            <div className={s.main}><div className={s.titleRow}><code className={s.name}>{hook.name}</code><Badge variant={hook.kind === 'custom' ? 'info' : 'neutral'}>{hook.kind}</Badge>{hook.enabled ? <Badge variant="success">{t('hooks.on')}</Badge> : <Badge variant="neutral">{t('hooks.off')}</Badge>}</div><p className={s.summary}>{hook.config_summary}</p></div>
            <label className={s.toggleLabel}><input type="checkbox" checked={hook.enabled} disabled={pendingName !== null} onChange={() => onToggle(hook)} aria-label={`${hook.enabled ? t('hooks.disable') : t('hooks.enable')}: ${hook.name}`} data-testid={`hook-toggle-${hook.name}`} /></label>
          </li>
        ))}</ul></Card>
      )}
      <div className={s.eventsPanel} data-testid="hooks-events-panel">
        <button type="button" className={s.eventsToggle} onClick={onEventsToggle} aria-expanded={eventsOpen} data-testid="hooks-events-toggle">{eventsOpen ? '▾' : '▸'} {t('hooks.events.title')}</button>
        {eventsOpen && <Card level="flat" padding="sm" className={s.eventsCard}>
          {eventsLoading ? <div className={s.center}><Spinner size={14} /> {t('common.loading')}</div> : <ul className={s.eventsList} data-testid="hooks-events-list">{events.map((e) => (
            <li key={e.kind} className={s.eventsRow}><div className={s.eventsMain}><code className={s.name}>{e.kind}</code><span className={s.summary}>{e.description}</span></div><div className={s.eventsDecisions}>{e.decisions.length === 0 && <Badge variant="neutral">{t('hooks.events.notificationOnly')}</Badge>}{e.decisions.map((d) => <Badge key={d} variant="neutral">{d}</Badge>)}</div></li>
          ))}</ul>}
        </Card>}
      </div>
    </PageShell>
  );
}
