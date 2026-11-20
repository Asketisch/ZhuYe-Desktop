import { useState } from 'react';
import type { ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/utils/i18n';
import { zhuye_get_autopilot_config, zhuye_update_autopilot_config, zhuye_autopilot_history, zhuye_list_agent_defs, type ZhuyeAutopilotConfig } from '@/utils/commands';
import type { AutopilotRunView, AutopilotViewProps } from '@/contracts/autopilot';

const DEFAULT_CONFIG: ZhuyeAutopilotConfig = { enabled: false, schedule: '', taskTemplate: '', agent: null, maxConcurrent: 1 };

export function AutopilotBinding({ view: View }: { view: ComponentType<AutopilotViewProps> }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ZhuyeAutopilotConfig | null>(null);
  const configQuery = useQuery({ queryKey: ['autopilot', 'config'], queryFn: zhuye_get_autopilot_config });
  const historyQuery = useQuery({ queryKey: ['autopilot', 'history'], queryFn: zhuye_autopilot_history, refetchInterval: 5_000 });
  const agentsQuery = useQuery({ queryKey: ['agents', 'list'], queryFn: zhuye_list_agent_defs, staleTime: 30_000 });
  const updateMutation = useMutation({ mutationFn: (cfg: ZhuyeAutopilotConfig) => zhuye_update_autopilot_config(cfg), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['autopilot', 'config'] }); setDraft(null); } });
  const config = draft ?? configQuery.data ?? DEFAULT_CONFIG;
  const update = <K extends keyof ZhuyeAutopilotConfig>(key: K, value: ZhuyeAutopilotConfig[K]) => setDraft({ ...config, ...draft, [key]: value });
  return <View t={t} config={config} isEditing={draft !== null}
    configLoading={configQuery.isLoading} configError={configQuery.isError}
    agents={(agentsQuery.data ?? []).map((agent) => agent.name)}
    history={(historyQuery.data ?? []) as AutopilotRunView[]}
    historyLoading={historyQuery.isLoading} historyError={historyQuery.isError}
    updating={updateMutation.isPending} updateError={updateMutation.isError}
    onUpdate={update} onEdit={() => setDraft(config)} onCancel={() => setDraft(null)}
    onSave={() => { if (draft) updateMutation.mutate(draft); }} />;
}
