import { Volume2, Bell, Check } from 'lucide-react';
import type { SettingsNotificationsProps } from '@/contracts/settingsNotifications';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import s from './SettingsView.module.css';
export function NotificationsSection({ t, opts, permission, onPatch, onRequestPermission }: SettingsNotificationsProps) {
  return (
    <div>
      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}>
          <Icon icon={Volume2} size={16} /> {t('settings.notifications.sound')}
        </h3>
        <p className={s.cardDesc}>
          {t('settings.notifications.soundHelp')}
        </p>

        <label className={s.row}>
          <input
            type="checkbox"
            checked={opts.sound}
            onChange={(e) => onPatch({ sound: e.target.checked })}
          />
          <span>{t('settings.notifications.chime')}</span>
        </label>

        <label className={s.row}>
          <span>{t('settings.notifications.volume')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opts.volume ?? 0.4}
            onChange={(e) => onPatch({ volume: Number.parseFloat(e.target.value) })}
          />
          <span className={s.subtle}>
            {Math.round((opts.volume ?? 0.4) * 100)}%
          </span>
        </label>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}>
          <Icon icon={Bell} size={16} /> {t('settings.notifications.desktop')}
        </h3>
        <p className={s.cardDesc}>
          {t('settings.notifications.desktopHelp')}
        </p>

        <div className={s.row}>
          <Badge variant={permission === 'granted' ? 'success' : 'warning'}>
            {permission === 'granted' ? (
              <>
                <Icon icon={Check} size={12} /> {t('settings.notifications.granted')}
              </>
            ) : (
              permission
            )}
          </Badge>
          {permission === 'default' && (
            <Button variant="ghost" onClick={onRequestPermission}>
              {t('settings.notifications.request')}
            </Button>
          )}
        </div>

        <label className={s.row}>
          <input
            type="checkbox"
            checked={opts.system}
            disabled={permission !== 'granted'}
            onChange={(e) => onPatch({ system: e.target.checked })}
          />
          <span>{t('settings.notifications.desktop')}</span>
        </label>

        <label className={s.row}>
          <input
            type="checkbox"
            checked={opts.onlyUnfocused ?? true}
            disabled={permission !== 'granted' || !opts.system}
            onChange={(e) => onPatch({ onlyUnfocused: e.target.checked })}
          />
          <span>{t('settings.notifications.onlyUnfocused')}</span>
        </label>
        <p className={s.cardDesc}>{t('settings.notifications.onlyUnfocusedHelp')}</p>

        <label className={s.row}>
          <span>{t('settings.notifications.minDuration')}</span>
          <select
            value={String(opts.minDurationMs ?? 60_000)}
            disabled={permission !== 'granted' || !opts.system}
            onChange={(e) => onPatch({ minDurationMs: Number(e.target.value) })}
          >
            <option value="0">{t('settings.notifications.minDurationOff')}</option>
            <option value="30000">{t('settings.notifications.minDuration30s')}</option>
            <option value="60000">{t('settings.notifications.minDuration60s')}</option>
            <option value="120000">{t('settings.notifications.minDuration2m')}</option>
          </select>
        </label>

        <label className={s.row}>
          <input
            type="checkbox"
            checked={opts.notifyApproval ?? true}
            disabled={permission !== 'granted' || !opts.system}
            onChange={(e) => onPatch({ notifyApproval: e.target.checked })}
          />
          <span>{t('settings.notifications.approval')}</span>
        </label>
        <p className={s.cardDesc}>{t('settings.notifications.approvalHelp')}</p>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}>
          <Icon icon={Bell} size={16} /> {t('settings.notifications.dockBadge')}
        </h3>
        <p className={s.cardDesc}>{t('settings.notifications.dockBadgeHelp')}</p>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={opts.dockBadge ?? false}
            onChange={(e) => onPatch({ dockBadge: e.target.checked })}
          />
          <span>{t('settings.notifications.dockBadge')}</span>
        </label>
      </Card>
    </div>
  );
}
