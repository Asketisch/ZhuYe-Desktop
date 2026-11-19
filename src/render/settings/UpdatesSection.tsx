import { Download, Loader2, RefreshCw } from 'lucide-react';
import type { UpdatesSectionProps } from '@/contracts/settingsCards';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import s from './UpdatesSection.module.css';
export function UpdatesSection({ t, busy, info, onCheck }: UpdatesSectionProps) {
  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-updates">
      <div className={s.header}>
        <Icon icon={RefreshCw} size={14} />
        <strong>{t('settings.updates.title')}</strong>
        {info && (
          <Badge variant={info.error ? 'warning' : info.updateAvailable ? 'accent' : 'success'}>
            {info.error
              ? t('settings.updates.probeFailed')
              : info.updateAvailable
                ? t('settings.updates.available', { version: info.latestVersion ?? '?' })
                : t('settings.updates.upToDate')}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onCheck}
          data-testid="updates-check"
        >
          {busy ? <Loader2 size={12} className={s.spin} /> : <RefreshCw size={12} />}
          {t('settings.updates.check')}
        </Button>
      </div>

      {info && !info.error && (
        <p className={s.hint} data-testid="updates-current">
          {t('settings.updates.current', { version: info.currentVersion })}
        </p>
      )}

      {info?.error && (
        <p className={s.error} data-testid="updates-error">
          {info.error}
        </p>
      )}

      {info?.updateAvailable && (
        <div className={s.body} data-testid="updates-available">
          {info.releaseNotes && <pre className={s.notes}>{info.releaseNotes}</pre>}
          {info.releaseUrl && (
            <a className={s.link} href={info.releaseUrl} target="_blank" rel="noreferrer">
              <Icon icon={Download} size={12} />
              {t('settings.updates.openRelease')}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
