/**
 * ConfigInfoLine —— 配置文件位置 / 分析健康度 / 活跃 agent。
 *
 * 手改 `config.toml` 的用户需要知道「应用读的是哪个文件」—— 此前这个
 * 信息在 GUI 里完全没有出口（只能自己回忆 `~/.zhuye/config.toml`）。
 * 顺带展示当前活跃 agent 与分析上报状态。
 */
import { useQuery } from '@tanstack/react-query';
import { FileCog } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_config_info } from '@/utils/commands/runtimeStatus';
import s from './ConfigInfoLine.module.css';

export function ConfigInfoLine() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['config-info'],
    queryFn: () => reflect_config_info(),
    staleTime: 30_000,
  });
  const info = q.data;
  if (!info) return null;

  return (
    <div className={s.root} data-testid="settings-config-info">
      <div className={s.line} title={info.path ?? undefined}>
        <Icon icon={FileCog} size={11} />
        <code className={s.path}>{info.path ?? t('settings.configInfo.noPath')}</code>
        {!info.exists && <span className={s.warn}>{t('settings.configInfo.missing')}</span>}
      </div>
      <div className={s.line}>
        <span className={s.key}>{t('settings.configInfo.activeAgent')}</span>
        <span className={s.value}>{info.activeAgent}</span>
      </div>
      <div className={s.line} title={info.analyticsStatus}>
        <span className={s.key}>{t('settings.configInfo.analytics')}</span>
        <span className={s.value}>
          {info.analyticsEnabled
            ? t('settings.configInfo.analyticsOn')
            : t('settings.configInfo.analyticsOff')}
        </span>
      </div>
    </div>
  );
}
