import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zhuye_config_info } from '@/utils/commands/runtimeStatus';
import { useI18n } from '@/utils/i18n';
import type { SettingsConfigInfoLineProps } from '@/contracts/settingsConfigInfoLine';
export function ConfigInfoLineBinding({ view: View }: { view: ComponentType<SettingsConfigInfoLineProps> }) {
  const { t } = useI18n();
  const query = useQuery({ queryKey: ['config-info'], queryFn: zhuye_config_info, staleTime: 30_000 });
  return query.data ? <View t={t} info={query.data} /> : null;
}
