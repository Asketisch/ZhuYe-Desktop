import { FileCog } from 'lucide-react';
import type { SettingsConfigInfoLineProps } from '@/contracts/settings/settingsConfigInfoLine';
import { Icon } from '../design-system/Icon';
import s from './ConfigInfoLine.module.css';
export function ConfigInfoLine({ t, info }: SettingsConfigInfoLineProps) {
  return <div className={s.root} data-testid="settings-config-info">
    <div className={s.line} title={info.path ?? undefined}><Icon icon={FileCog} size={11} /><code className={s.path}>{info.path ?? t('settings.configInfo.noPath')}</code>{!info.exists && <span className={s.warn}>{t('settings.configInfo.missing')}</span>}</div>
    <div className={s.line}><span className={s.key}>{t('settings.configInfo.activeAgent')}</span><span className={s.value}>{info.activeAgent}</span></div>
    <div className={s.line} title={info.analyticsStatus}><span className={s.key}>{t('settings.configInfo.analytics')}</span><span className={s.value}>{info.analyticsEnabled ? t('settings.configInfo.analyticsOn') : t('settings.configInfo.analyticsOff')}</span></div>
  </div>;
}
