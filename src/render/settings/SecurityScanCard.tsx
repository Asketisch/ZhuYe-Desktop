import { ShieldCheck, Loader2 } from 'lucide-react';
import type { SecurityScanCardProps } from '@/contracts/settingsCards';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import s from './SecurityScanCard.module.css';
export function SecurityScanCard({ t, busy, report, error, onRun }: SecurityScanCardProps) {
  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-security-scan">
      <div className={s.header}>
        <Icon icon={ShieldCheck} size={14} />
        <strong>{t('settings.securityScan.title')}</strong>
        {report && (
          <Badge variant={report.ran ? (report.exitCode === 0 ? 'success' : 'warning') : 'neutral'}>
            {report.ran
              ? t('settings.securityScan.ran', { code: String(report.exitCode ?? 0) })
              : t('settings.securityScan.unavailable')}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRun}
          data-testid="security-scan-run"
        >
          {busy ? <Loader2 size={12} className={s.spin} /> : <ShieldCheck size={12} />}
          {t('settings.securityScan.run')}
        </Button>
      </div>
      <p className={s.hint}>{t('settings.securityScan.hint')}</p>
      {error && (
        <p className={s.error} data-testid="security-scan-error">
          {error}
        </p>
      )}
      {report && (
        <div className={s.report} data-testid="security-scan-report">
          <p className={s.summary}>{report.summary}</p>
          {report.output && <pre className={s.output}>{report.output}</pre>}
        </div>
      )}
    </Card>
  );
}
