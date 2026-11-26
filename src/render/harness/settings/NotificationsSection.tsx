import { Bell, Check, Volume2 } from 'lucide-react';
import type { SettingsNotificationsProps } from '@/contracts/settings/settingsNotifications';
import { GroupCard, Row, SubHead, Select } from './settingsKit';
import kit from './SettingsPage.module.css';

/** NotificationsSection —— 通知分区（纯展示，设置页套件视觉）。 */
export function NotificationsSection({ t, opts, permission, onPatch, onRequestPermission }: SettingsNotificationsProps) {
  const granted = permission === 'granted';
  return (
    <div className={kit.secBody}>
      <SubHead title={<><Volume2 size={16} strokeWidth={1.5} aria-hidden /> {t('settings.notifications.sound')}</>} description={t('settings.notifications.soundHelp')} />
      <GroupCard>
        <Row label={t('settings.notifications.chime')}>
          <input
            type="checkbox"
            className={kit.checkbox}
            checked={opts.sound}
            aria-label={t('settings.notifications.chime')}
            onChange={(e) => onPatch({ sound: e.target.checked })}
          />
        </Row>
        <Row label={t('settings.notifications.volume')}>
          <span className={kit.rangeCtl}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opts.volume ?? 0.4}
              aria-label={t('settings.notifications.volume')}
              onChange={(e) => onPatch({ volume: Number.parseFloat(e.target.value) })}
            />
            <span className={kit.rangeVal}>{Math.round((opts.volume ?? 0.4) * 100)}%</span>
          </span>
        </Row>
      </GroupCard>

      <SubHead title={<><Bell size={16} strokeWidth={1.5} aria-hidden /> {t('settings.notifications.desktop')}</>} description={t('settings.notifications.desktopHelp')} />
      <GroupCard>
        <Row label={t('settings.notifications.desktop')}>
          <span className={kit.rowCtl}>
            <span className={kit.badge} data-fg={granted || undefined}>
              {granted ? <><Check size={12} strokeWidth={1.5} aria-hidden /> {t('settings.notifications.granted')}</> : permission}
            </span>
            {permission === 'default' && (
              <button type="button" className={kit.btn} onClick={onRequestPermission}>
                {t('settings.notifications.request')}
              </button>
            )}
            <input
              type="checkbox"
              className={kit.checkbox}
              checked={opts.system}
              disabled={!granted}
              aria-label={t('settings.notifications.desktop')}
              onChange={(e) => onPatch({ system: e.target.checked })}
            />
          </span>
        </Row>
        <Row label={t('settings.notifications.onlyUnfocused')} description={t('settings.notifications.onlyUnfocusedHelp')}>
          <input
            type="checkbox"
            className={kit.checkbox}
            checked={opts.onlyUnfocused ?? true}
            disabled={!granted || !opts.system}
            aria-label={t('settings.notifications.onlyUnfocused')}
            onChange={(e) => onPatch({ onlyUnfocused: e.target.checked })}
          />
        </Row>
        <Row label={t('settings.notifications.minDuration')}>
          <Select
            value={String(opts.minDurationMs ?? 60_000)}
            ariaLabel={t('settings.notifications.minDuration')}
            disabled={!granted || !opts.system}
            onChange={(v) => onPatch({ minDurationMs: Number(v) })}
            options={[
              { value: '0', label: t('settings.notifications.minDurationOff') },
              { value: '30000', label: t('settings.notifications.minDuration30s') },
              { value: '60000', label: t('settings.notifications.minDuration60s') },
              { value: '120000', label: t('settings.notifications.minDuration2m') },
            ]}
          />
        </Row>
        <Row label={t('settings.notifications.approval')} description={t('settings.notifications.approvalHelp')}>
          <input
            type="checkbox"
            className={kit.checkbox}
            checked={opts.notifyApproval ?? true}
            disabled={!granted || !opts.system}
            aria-label={t('settings.notifications.approval')}
            onChange={(e) => onPatch({ notifyApproval: e.target.checked })}
          />
        </Row>
      </GroupCard>

      <SubHead title={<><Bell size={16} strokeWidth={1.5} aria-hidden /> {t('settings.notifications.dockBadge')}</>} description={t('settings.notifications.dockBadgeHelp')} />
      <GroupCard>
        <Row label={t('settings.notifications.dockBadge')}>
          <input
            type="checkbox"
            className={kit.checkbox}
            checked={opts.dockBadge ?? false}
            aria-label={t('settings.notifications.dockBadge')}
            onChange={(e) => onPatch({ dockBadge: e.target.checked })}
          />
        </Row>
      </GroupCard>
    </div>
  );
}
