import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { AboutViewProps } from '@/contracts/harness/basicPages';
import { ping, zhuye_agent_status } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';

/** 读取关于页面所需的运行状态。 */
export function AboutBinding({ view: View }: { view: ComponentType<AboutViewProps> }) {
  const { t } = useI18n();
  const pingQuery = useQuery({ queryKey: ['ping'], queryFn: ping, staleTime: Infinity });
  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  return <View t={t} version={pingQuery.data?.version ?? '—'} status={statusQuery.data} date={new Date().toLocaleDateString()} />;
}
