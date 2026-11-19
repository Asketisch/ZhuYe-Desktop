import { ShieldAlert, Loader2 } from 'lucide-react';
import type { GuardStatsCardProps } from '@/contracts/settingsCards';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import s from './GuardStatsCard.module.css';
export function GuardStatsCard({ t, busy, error, queried, onRun }: GuardStatsCardProps) {
  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-guard-stats">
      <div className={s.header}>
        <Icon icon={ShieldAlert} size={14} />
        <strong>{t('settings.guardStats.title')}</strong>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRun}>
          {busy ? <Icon icon={Loader2} size={12} className={s.spin} /> : null}
          {t('settings.guardStats.query')}
        </Button>
      </div>
      <p className={s.hint}>{t('settings.guardStats.hint')}</p>
      {queried && (
        <p className={s.hint} data-testid="settings-guard-stats-sent">
          {t('settings.guardStats.sent')}
        </p>
      )}
      {error && <p className={s.error}>{error}</p>}
    </Card>
  );
}
