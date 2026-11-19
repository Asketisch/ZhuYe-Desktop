import { Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import type { UpdatesSectionProps } from '@/contracts/settingsCards';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import s from './UpdatesSection.module.css';
export function UpdatesSection({ t, busy, info, onCheck, install, onInstall, onRelaunch }: UpdatesSectionProps) {
  const showInstall =
    install !== null ||
    (info !== null && !info.error && info.updateAvailable);
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

      {/* OTA 自更新:有可用更新或本次会话发起过安装时展示 */}
      {showInstall && (
        <div className={s.body} data-testid="updates-install">
          {install?.phase === 'error' && (
            <p className={s.error} data-testid="updates-install-error">
              {install.error}
            </p>
          )}
          {(install?.phase === 'downloading' || install?.phase === 'installing') && (
            <div className={s.progressRow} data-testid="updates-install-progress">
              <Loader2 size={12} className={s.spin} />
              <div className={s.progressTrack}>
                <div
                  className={s.progressFill}
                  style={install.percent !== null ? { width: `${install.percent}%` } : undefined}
                />
              </div>
              <span>
                {install.phase === 'downloading'
                  ? install.percent !== null
                    ? t('settings.updates.downloadingPercent', { percent: install.percent })
                    : t('settings.updates.downloading')
                  : t('settings.updates.installing')}
              </span>
            </div>
          )}
          {install?.phase === 'done' && (
            <div className={s.progressRow} data-testid="updates-install-done">
              <span>
                {t('settings.updates.installed', { version: install.version ?? '?' })}
              </span>
              <Button size="sm" variant="primary" onClick={onRelaunch} data-testid="updates-relaunch">
                <RotateCcw size={12} />
                {t('settings.updates.relaunch')}
              </Button>
            </div>
          )}
          {!install && info?.updateAvailable && (
            <Button
              size="sm"
              variant="primary"
              onClick={onInstall}
              data-testid="updates-install-start"
            >
              <Download size={12} />
              {t('settings.updates.install')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
