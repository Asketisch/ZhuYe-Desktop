/**
 * About —— 版本/状态信息（CSS Modules 版）。
 */
import { useQuery } from '@tanstack/react-query';
import { Info, Github, Heart } from 'lucide-react';
import { ping, reflect_agent_status } from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import s from './AboutView.module.css';

export function AboutView() {
  const { t } = useI18n();
  const pingQ = useQuery({ queryKey: ['ping'], queryFn: ping, staleTime: Infinity });
  const statusQ = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });

  const version = pingQ.data?.version ?? '—';
  const status = statusQ.data;

  return (
    <PageShell icon={Info} title={t('about.title')} width="md">
      {/* Brand */}
      <Card level="outlined" padding="lg" className={s.brandCard}>
        <div className={s.brandRow}>
          <div className={s.logo}>Z</div>
          <div>
            <div className={s.brandName}>{t('app.title')}</div>
            <div className={s.brandTagline}>{t('about.tagline')}</div>
          </div>
        </div>
      </Card>

      {/* Info rows */}
      <Card level="outlined" padding="md" className={s.infoCard}>
        <Row label={t('about.version')} value={<code className={s.mono}>{version}</code>} />
        <Row label={t('about.buildDate')} value={new Date().toLocaleDateString()} />
        {status && (
          <>
            <Row label={t('about.model')} value={<code className={s.mono}>{status.model}</code>} />
            <Row label={t('about.workspace')} value={<code className={s.mono}>{status.workspace}</code>} />
            <Row
              label={t('about.status')}
              value={
                status.has_model ? (
                  <Badge variant="success" dot>{t('about.ready')}</Badge>
                ) : (
                  <Badge variant="warning" dot>{t('about.degraded')}</Badge>
                )
              }
            />
          </>
        )}
      </Card>

      {/* Sections */}
      <section className={s.section}>
        <h3 className={s.sectionTitle}>{t('about.agent')}</h3>
        <p className={s.sectionText}>
          {t('about.agentDesc')}
        </p>
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>{t('about.builtWith')}</h3>
        <p className={s.sectionText}>
          {t('about.builtWithDesc')}
        </p>
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>{t('about.links')}</h3>
        <div className={s.linkRow}>
          <span className={s.linkItem}>
            <Icon icon={Github} size={14} /> {t('about.source')}
          </span>
          <span className={s.linkItem}>
            <Icon icon={Heart} size={14} /> {t('about.openSource')}
          </span>
        </div>
      </section>
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={s.rowValue}>{value}</span>
    </div>
  );
}
