import { useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useActivityController } from './useActivityController';
import { useOsNotifications } from './useOsNotifications';

export type NotificationFilter = 'all' | 'error' | 'pending';
export type NotificationTab = 'inbox' | 'activity' | 'mentions';
export interface NotifItem { id: string; level: 'error' | 'warn' | 'info'; title: string; body: string }

export function useNotificationsController() {
  const osNotify = useOsNotifications();
  const lastError = useAgentStore((state) => state.lastError);
  const clearError = useAgentStore((state) => state.clearError);
  const approvals = useAgentStore((state) => state.pendingApprovals);
  const questions = useAgentStore((state) => state.pendingQuestions);
  const askUsers = useAgentStore((state) => state.pendingAskUser);
  const plan = useAgentStore((state) => state.pendingPlan);
  const mcpServers = useAgentStore((state) => state.mcpServers);
  const lspServers = useAgentStore((state) => state.lspServers);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [tab, setTab] = useState<NotificationTab>('inbox');
  const activity = useActivityController(tab);
  const items = useMemo<NotifItem[]>(() => {
    const output: NotifItem[] = [];
    if (lastError) output.push({ id: 'err', level: 'error', title: 'Error', body: lastError });
    for (const approval of approvals) output.push({ id: `ap-${approval.id}`, level: 'warn', title: `${approval.kind} approval pending`, body: approval.toolName ? `Tool: ${approval.toolName}` : 'Awaiting your decision' });
    for (const question of questions) output.push({ id: `q-${question.id}`, level: 'warn', title: 'Question pending', body: 'Agent needs an answer' });
    for (const input of askUsers) output.push({ id: `u-${input.id}`, level: 'warn', title: 'Input pending', body: 'Agent needs your input' });
    if (plan) output.push({ id: 'plan', level: 'warn', title: 'Plan pending', body: 'Review and approve the plan' });
    for (const server of mcpServers) output.push({ id: `mcp-${server.name}`, level: server.status === 'failed' ? 'error' : 'info', title: `MCP server ${server.name} ${server.status}`, body: server.detail ?? '' });
    for (const server of lspServers) output.push({ id: `lsp-${server.name}`, level: server.status === 'failed' ? 'error' : 'info', title: `LSP server ${server.name} ${server.status}`, body: server.detail ?? '' });
    return output;
  }, [approvals, askUsers, lastError, lspServers, mcpServers, plan, questions]);
  const errorCount = items.filter((item) => item.level === 'error').length;
  const pendingCount = items.filter((item) => item.level === 'warn').length;
  const inboxFiltered = items.filter((item) => filter === 'error' ? item.level === 'error' : filter === 'pending' ? item.level === 'warn' : true);
  return { osNotify, lastError, clearError, filter, setFilter, tab, setTab, activity, items, inboxFiltered, errorCount, pendingCount };
}
export type NotificationsController = ReturnType<typeof useNotificationsController>;
