import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { zhuye_agent_status, zhuye_list_sessions, zhuye_sandbox_status } from '@/utils/commands';
import { getTheme, setTheme, getResolvedTheme, subscribeTheme, type ThemeMode } from '@/logic/harness/preferences/theme';
import { useContextRatio } from './useContextRatio';
import { isUsableModelSpec } from './modelLabel';
import { useShellUi } from '@/stores/shellUi';

export function useStatusBarController() {
  const session = useAgentStore((state) => state.session);
  const permissionMode = useAgentStore((state) => state.permissionMode);
  const cyclePermissionMode = useAgentStore((state) => state.cyclePermissionMode);
  const mcpServers = useAgentStore((state) => state.mcpServers);
  const lspServers = useAgentStore((state) => state.lspServers);
  const lastError = useAgentStore((state) => state.lastError);
  const clearError = useAgentStore((state) => state.clearError);
  const tokens = useAgentStore((state) => state.tokens);
  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  const sessionsQuery = useQuery({ queryKey: ['sessions'], queryFn: () => zhuye_list_sessions(), staleTime: 60_000 });
  const sandboxQuery = useQuery({ queryKey: ['sandbox-status'], queryFn: zhuye_sandbox_status, staleTime: 60_000 });
  const ctx = useContextRatio();
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => getResolvedTheme());
  const [mode, setMode] = useState<ThemeMode>(() => getTheme());
  useEffect(() => subscribeTheme(setResolved), []);
  const cycleTheme = () => { const next: ThemeMode = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark'; setTheme(next); setMode(next); };
  const sessionModel = session && isUsableModelSpec(session.model) ? `${session.model} @ ${session.provider}` : null;
  const status = statusQuery.data;
  const modelLabel = sessionModel ?? (status && status.has_model ? status.model : null);
  const modelKind: 'ok' | 'warn' | 'error' = status?.degraded_reason ? 'warn' : sessionModel != null || (status && status.has_model) ? 'ok' : 'error';
  // 点击状态栏上下文环 → 打开右 dock 检查器并落到概览页(可编程切页签,
  // 与 Inspector 内部子页签同一入口)。
  const openDockTab = useShellUi((s) => s.openDockTab);
  const setInspectorTab = useShellUi((s) => s.setInspectorTab);
  const openInspectorOverview = () => {
    openDockTab('inspector');
    setInspectorTab('overview');
  };
  return { session, permissionMode, cyclePermissionMode, mcpServers, lspServers, lastError, clearError, tokens,
    statusQuery, sessionsQuery, sandboxQuery, sessionCount: sessionsQuery.data?.length ?? 0, ctx,
    resolved, mode, cycleTheme, status, sessionModel, modelLabel, modelKind,
    modelTooltip: status?.degraded_reason ?? undefined, openInspectorOverview };
}
export type StatusBarController = ReturnType<typeof useStatusBarController>;
