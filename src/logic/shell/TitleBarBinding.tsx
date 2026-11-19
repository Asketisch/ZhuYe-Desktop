import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_agent_status } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { isUsableModelSpec } from './modelLabel';
import type { TitleBarProps } from '@/contracts/titleBar';
export function TitleBarBinding({ view: View, sidebarOpen, inspectorOpen, onToggleSidebar, onToggleInspector }: {
  view: ComponentType<TitleBarProps>; sidebarOpen: boolean; inspectorOpen: boolean;
  onToggleSidebar: () => void; onToggleInspector: () => void;
}) {
  const location = useLocation(); const session = useAgentStore((state) => state.session);
  const permissionMode = useAgentStore((state) => state.permissionMode); const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: reflect_agent_status, staleTime: 30_000 });
  const sessionLabel = session && isUsableModelSpec(session.model)
    ? `${session.model} @ ${session.provider}` : statusQuery.data?.has_model ? statusQuery.data.model : t('shell.sessionWaiting');
  return <View t={t} pathname={location.pathname} sessionLabel={sessionLabel} permissionMode={permissionMode}
    sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen} onToggleSidebar={onToggleSidebar} onToggleInspector={onToggleInspector} />;
}
