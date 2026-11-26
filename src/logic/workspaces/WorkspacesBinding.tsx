/**
 * Workspaces —— 当前工作区、最近项目、附加目录管理的绑定。
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import {
  zhuye_agent_status,
  zhuye_current_workspace_dirs,
  zhuye_list_workspaces,
  zhuye_pick_workspace_folder,
  zhuye_remove_workspace,
  zhuye_reveal_path,
  zhuye_set_workspace,
  zhuye_set_workspace_dirs,
} from '@/utils/commands';
import { confirmDialog } from '@/logic/modals/confirm';
import { useI18n } from '@/utils/i18n';
import { relativeTime } from '@/utils/time';
import { useAgentStore } from '@/stores/agentStore';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/shell/useCurrentWorkspace';
import { SESSIONS_QUERY_KEY } from '@/logic/sessions/useSessions';
import type { WorkspacesViewProps } from '@/contracts/workbench/workspaces';

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}
function lastUsedIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkspacesBinding({ view: View }: { view: ComponentType<WorkspacesViewProps> }) {
  const { t, tp } = useI18n();
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [adding, setAdding] = useState(false);
  const statusQ = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  const workspacesQ = useQuery({ queryKey: ['workspaces'], queryFn: () => zhuye_list_workspaces(), staleTime: 30_000 });
  const dirsQ = useQuery({ queryKey: ['workspace-dirs'], queryFn: zhuye_current_workspace_dirs, staleTime: 10_000 });

  const currentWs = statusQ.data?.workspace;

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['agent-status'] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
    void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
  };

  const onUse = async (path: string) => {
    try {
      await zhuye_set_workspace(path, true);
      pushToast({ kind: 'success', message: t('workspaces.setTo', { name: basename(path) }) });
      refreshAll();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.switchFailed', { msg: errMsg(e) }) });
    }
  };

  const onRemove = async (path: string) => {
    if (!await confirmDialog({ title: t('sidebar.group.remove'), message: t('sidebar.group.removeConfirm') })) return;
    try {
      await zhuye_remove_workspace(path);
      pushToast({ kind: 'success', message: t('workspaces.removedToast', { name: basename(path) }) });
      refreshAll();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.removeFailed', { msg: errMsg(e) }) });
    }
  };

  const onPickFolder = async () => {
    let picked: string | null;
    try {
      picked = await zhuye_pick_workspace_folder();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.pickFailed', { msg: errMsg(e) }) });
      return;
    }
    if (picked) await onUse(picked);
  };

  const onReveal = async (path: string) => {
    try {
      await zhuye_reveal_path(path);
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.revealFailed', { msg: errMsg(e) }) });
    }
  };

  const pickAndAdd = async () => {
    let picked: string | null = null;
    try {
      picked = await zhuye_pick_workspace_folder();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.pickFailed', { msg: errMsg(e) }) });
      return;
    }
    if (!picked) return;
    const current = dirsQ.data ?? { main: '', additional: [] };
    if (current.additional.includes(picked) || picked === current.main) return;
    try {
      await zhuye_set_workspace_dirs(current.main, [...current.additional, picked]);
      pushToast({ kind: 'success', message: t('workspaces.additionalAdded') });
      void qc.invalidateQueries({ queryKey: ['workspace-dirs'] });
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.additionalFailed', { msg: errMsg(e) }) });
    }
    setAdding(false);
  };

  const removeDir = async (dir: string) => {
    const current = dirsQ.data ?? { main: '', additional: [] };
    try {
      await zhuye_set_workspace_dirs(current.main, current.additional.filter((d) => d !== dir));
      void qc.invalidateQueries({ queryKey: ['workspace-dirs'] });
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.additionalFailed', { msg: errMsg(e) }) });
    }
  };

  const raw = workspacesQ.data ?? [];
  const removed = raw.filter((w) => w.hidden).map((w) => ({
    path: w.path,
    label: w.label,
    sessionCount: w.session_count,
    lastUsedLabel: t('workspaces.lastUsed', { time: relativeTime(lastUsedIso(w.last_used)) }),
    isActive: false,
  }));
  const recent = raw.filter((w) => !w.hidden).map((w) => ({
    path: w.path,
    label: w.label,
    sessionCount: w.session_count,
    lastUsedLabel: t('workspaces.lastUsed', { time: relativeTime(lastUsedIso(w.last_used)) }),
    isActive: w.path === currentWs,
  }));

  return <View
    t={t} tp={tp} current={currentWs}
    loading={workspacesQ.isLoading} error={Boolean(workspacesQ.isError)}
    errorMessage={workspacesQ.isError ? errMsg(workspacesQ.error) : null}
    workspaces={recent} removed={removed}
    dirs={{ main: dirsQ.data?.main ?? '', additional: dirsQ.data?.additional ?? [], adding }}
    onOpenFolder={() => { void onPickFolder(); }}
    onReveal={(path) => { void onReveal(path); }}
    onUse={(path) => { void onUse(path); }}
    onRemove={(path) => { void onRemove(path); }}
    onAddDir={() => { setAdding(true); void pickAndAdd(); }}
    onRemoveDir={(dir) => { void removeDir(dir); }}
  />;
}
