import { GitPullRequestArrow, ExternalLink } from 'lucide-react';
import type { PullRequestsViewProps } from '@/contracts/pulls';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import { EmptyState } from '../design-system/EmptyState';
import { Button } from '../design-system/Button';
import s from './PullRequestsView.module.css';

export function PullRequestsView({ t, tp, prs, error, loading, onRefresh }: PullRequestsViewProps) {
  return (
    <PageShell icon={GitPullRequestArrow} title={t('pulls.title')} subtitle={t('pulls.subtitle')} width="lg">
      <div className={s.toolbar}><Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading} data-testid="pulls-refresh">{t('git.refresh')}</Button></div>
      {loading && <Card level="flat" padding="lg"><div className={s.center}><Spinner size={14} /> {t('common.loading')}</div></Card>}
      {!loading && error && <Card level="flat" padding="lg"><EmptyState icon={<Icon icon={GitPullRequestArrow} size={20} />} title={t('pulls.unavailable')} description={error} /></Card>}
      {!loading && !error && prs.length === 0 && <Card level="flat" padding="lg"><EmptyState icon={<Icon icon={GitPullRequestArrow} size={20} />} title={t('pulls.empty')} description={t('pulls.emptyDesc')} /></Card>}
      {!loading && prs.length > 0 && (
        <Card level="flat" padding="none">
          <div className={s.summary}><Badge variant="info">{tp('pulls.count', prs.length, { count: prs.length })}</Badge></div>
          <ul className={s.list}>{prs.map((pr) => (
            <li key={pr.number} className={s.row}><a className={s.link} href={pr.url} target="_blank" rel="noreferrer" data-testid={`pull-${pr.number}`}>
              <span className={s.iconWrap}><Icon icon={GitPullRequestArrow} size={14} /></span>
              <span className={s.main}><span className={s.title}><code className={s.number}>#{pr.number}</code> {pr.title}{pr.draft && <Badge variant="warning">{t('pulls.draft')}</Badge>}</span>
                <span className={s.meta}>{pr.author && <span>{pr.author}</span>}<span className={s.headRef}>{pr.head_ref}</span></span></span>
              <Icon icon={ExternalLink} size={12} className={s.external} /></a></li>
          ))}</ul>
        </Card>
      )}
    </PageShell>
  );
}
