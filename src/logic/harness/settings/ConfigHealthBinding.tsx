import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ComponentType } from 'react';
import type { ConfigHealthKey, ConfigHealthViewProps } from '@/contracts/harness/configHealth';
import { useI18n } from '@/utils/i18n';
import { zhuye_get_config } from '@/utils/commands/harness/config';
import { ping } from '@/utils/commands/harness/health';
import { zhuye_config_info } from '@/utils/commands/harness/runtimeStatus';

/** 向配置诊断视图提供当前问题和探活动作。 */
export function ConfigHealthBinding({ view: View }: { view: ComponentType<ConfigHealthViewProps> }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState<ConfigHealthKey[]>([]);
  const [drill, setDrill] = useState<{ backend: boolean; config: boolean } | null>(null);
  const config = useQuery({ queryKey: ['config-health'], queryFn: zhuye_config_info, staleTime: 60_000 });
  if (config.isLoading) return null;

  const issues = config.data?.issues ?? [];
  const runDrill = async () => {
    const results = { backend: false, config: false };
    try { await ping(); results.backend = true; } catch { /* 保留失败状态 */ }
    try { await zhuye_get_config(); results.config = true; } catch { /* 保留失败状态 */ }
    setDrill(results);
  };

  return <View
    issues={issues.filter((issue) => !dismissed.includes(issue.key)).map((issue) => ({
      ...issue, message: t(`settings.configHealth.issue.${issue.key}`),
    }))}
    showSandboxHint={issues.some((issue) => issue.key === 'sandbox-off')}
    drill={drill}
    labels={{
      critical: t('settings.configHealth.critical'), warn: t('settings.configHealth.warn'),
      close: t('common.close'), sandboxHint: t('settings.configHealth.sandboxHint'),
      drill: t('settings.configHealth.drill'),
    }}
    onDismiss={(key) => setDismissed((current) => [...current, key])}
    onDrill={() => { void runDrill(); }}
  />;
}
