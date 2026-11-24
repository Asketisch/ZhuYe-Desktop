import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { useBackgroundSessions } from '@/stores/backgroundSessions';
import { zhuye_agent_status, zhuye_current_workspace } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useThemeCycle } from './useThemeCycle';
import { isUsableModelSpec } from './modelLabel';
import type { TitleBarProps } from '@/contracts/titleBar';

/**
 * harness 标题条绑定：会话/模型状态 + 壳层 UI 状态 → 视图 props。
 */
export function TitleBarBinding({ view: View, sidebarOpen, inspectorOpen, onToggleSidebar, onToggleInspector }: {
  view: ComponentType<TitleBarProps>;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
}) {
  const location = useLocation();
  const session = useAgentStore((state) => state.session);
  const permissionMode = useAgentStore((state) => state.permissionMode);
  const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  const sessionLabel = session && isUsableModelSpec(session.model)
    ? `${session.model} @ ${session.provider}` : statusQuery.data?.has_model ? statusQuery.data.model : t('shell.sessionWaiting');
  // harness 壳层状态与动作。
  const ui = useShellUi();
  const { resolved, cycleTheme } = useThemeCycle();
  // 标题条主标题 = 当前工作区尾段（与 ShellBinding 同源查询键）。
  const wsQuery = useQuery({
    queryKey: ['current-workspace'],
    queryFn: zhuye_current_workspace,
    staleTime: 30_000,
    retry: 1,
  });
  const workspaceLabel = (() => {
    const path = wsQuery.data;
    if (!path) return t('harness.title.workspace');
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? path;
  })();
  // 待处理会话数（铃铛角标）：前台 pending 会话 + 后台 pending 会话。
  const foregroundPending = useAgentStore((s) =>
    Boolean(s.pendingPlan) || s.pendingQuestions.length > 0 || s.pendingAskUser.length > 0 ? 1 : 0);
  const background = useBackgroundSessions((s) => s.sessions);
  const backgroundPending = Object.values(background).filter((snap) => snap.pendingCount > 0).length;
  return <View t={t} pathname={location.pathname} sessionLabel={sessionLabel} permissionMode={permissionMode}
    sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen} onToggleSidebar={onToggleSidebar} onToggleInspector={onToggleInspector}
    workspaceLabel={workspaceLabel}
    pendingCount={foregroundPending + backgroundPending}
    termOpen={ui.termOpen} onToggleTerm={ui.toggleTerm}
    onOpenPalette={ui.togglePalette}
    onOpenInbox={ui.toggleInbox}
    semantic={ui.semantic} onToggleSemantic={ui.toggleSemantic}
    resolvedTheme={resolved} onToggleTheme={cycleTheme}
    onOpenSettings={() => ui.setSettingsOpen(true)}
  />;
}
