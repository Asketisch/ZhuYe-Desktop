/**
 * Remote controller hook（阶段 2 任务 2）。
 *
 * 拥有 TanStack 查询 + 突变：
 *   - `reflect_get_remote_config` / `reflect_update_remote_config`
 *   - `reflect_get_remote_status`
 *   - `reflect_tailscale_status`
 *   - `reflect_tailscale_daemon_command_preview`
 *
 * `start/stop/status` daemon 命令已存在，以便 iOS 设置卡片可以展示
 * "尚未实现" 的占位符而不产生 TypeScript 错误；controller 不会自动调用它们。
 */
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_get_remote_config,
  reflect_get_remote_status,
  reflect_status_server_start,
  reflect_status_server_state,
  reflect_status_server_stop,
  reflect_tailscale_daemon_command_preview,
  reflect_tailscale_status,
  reflect_update_remote_config,
  reflect_remote_hosts,
  reflect_remote_host_remove,
  reflect_remote_host_save,
  reflect_remote_sessions,
  reflect_remote_test,
  reflect_remote_connect,
  reflect_remote_disconnect,
  type ReflectRemoteConfigSnapshot,
  type ReflectRemoteHost,
  type ReflectRemoteSessionInfo,
  type ReflectRemoteStatus,
  type ReflectTailscaleStatus,
} from '@/utils/commands';
import { useNavigate } from '@tanstack/react-router';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';

export const REMOTE_QUERY_KEY = ['remote'] as const;
const REMOTE_STALE_MS = 15_000;

export interface RemoteController {
  // 查询
  config: ReflectRemoteConfigSnapshot | null;
  status: ReflectRemoteStatus | null;
  tailscale: ReflectTailscaleStatus | null;
  previewCmd: string | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // 编辑器状态
  showForm: boolean;
  toggleShowForm: () => void;
  draft: RemoteConfigDraft;
  patchDraft: (patch: Partial<RemoteConfigDraft>) => void;

  // 突变操作
  save: () => Promise<void>;
  resetForm: () => void;
  statusServerPort: number | null;
  startServer: (port: number) => Promise<void>;
  stopServer: () => Promise<void>;
  serverBusy: boolean;

  isMutating: boolean;

  // ── SSH 远程开发(state/remote.rs 会话层接缝)──
  sshHosts: ReflectRemoteHost[];
  sshSessions: ReflectRemoteSessionInfo[];
  sshConnectForm: SshConnectDraft;
  patchSshConnectForm: (patch: Partial<SshConnectDraft>) => void;
  sshSaveHost: () => Promise<void>;
  sshRemoveHost: (name: string) => Promise<void>;
  sshTest: () => Promise<void>;
  sshConnect: () => Promise<void>;
  sshDisconnect: (sid: string) => Promise<void>;
  sshBusy: boolean;
  sshTesting: boolean;
}

/** SSH 连接表单草稿。 */
export interface SshConnectDraft {
  name: string;
  host: string;
  port: number | null;
  user: string;
  cwd: string;
}

export interface RemoteConfigDraft {
  host: string;
  port: number;
  authToken: string;
  autoConnect: boolean;
}

export function emptyRemoteDraft(c?: ReflectRemoteConfigSnapshot | null): RemoteConfigDraft {
  return {
    host: c?.host ?? '',
    port: c?.port ?? 4732,
    authToken: c?.authToken ?? '',
    autoConnect: c?.autoConnect ?? false,
  };
}

export function useRemoteController(): RemoteController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { t } = useI18n();

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<RemoteConfigDraft>(emptyRemoteDraft());

  const cfgQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'config'],
    queryFn: () => reflect_get_remote_config(),
    staleTime: REMOTE_STALE_MS,
  });

  const statusQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'status'],
    queryFn: () => reflect_get_remote_status(),
    staleTime: REMOTE_STALE_MS,
  });

  const tsQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'tailscale'],
    queryFn: () => reflect_tailscale_status(),
    staleTime: REMOTE_STALE_MS,
  });

  const previewQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'preview'],
    queryFn: () => reflect_tailscale_daemon_command_preview(),
    staleTime: Infinity,
  });

  // v1.11 基建#12:远程网页访问状态服务器。
  const serverQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'status-server'],
    queryFn: () => reflect_status_server_state(),
    staleTime: 5_000,
  });
  const startServerMut = useMutation({
    mutationFn: (port: number) => reflect_status_server_start(port),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY, 'status-server'] }),
    onError: () => undefined,
  });
  const stopServerMut = useMutation({
    mutationFn: () => reflect_status_server_stop(),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY, 'status-server'] }),
    onError: () => undefined,
  });
  const startServer = useCallback(
    async (port: number) => {
      try {
        const bound = await startServerMut.mutateAsync(port);
        pushToast({ kind: 'success', message: t('remote.statusServerStarted', { port: bound }) });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('remote.statusServerFailed', { message: (e as Error).message }),
        });
      }
    },
    [pushToast, startServerMut, t],
  );
  const stopServer = useCallback(async () => {
    try {
      await stopServerMut.mutateAsync();
      pushToast({ kind: 'success', message: t('remote.statusServerStopped') });
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('remote.statusServerFailed', { message: (e as Error).message }),
      });
    }
  }, [pushToast, stopServerMut, t]);

  const updateMut = useMutation({
    mutationFn: (d: RemoteConfigDraft) =>
      reflect_update_remote_config({
        host: d.host,
        port: d.port,
        authToken: d.authToken || null,
        autoConnect: d.autoConnect,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY] }),
  });

  const toggleShowForm = useCallback(() => setShowForm((v) => !v), []);

  // 切换表单打开时，从当前配置填充草稿。
  // 依赖只留 showForm:表单开着时后台 config refetch 返回,
  // 不能把用户正在编辑的 host/authToken 覆盖回服务器值。
  useEffect(() => {
    if (showForm) {
      setDraft(emptyRemoteDraft(cfgQ.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  const patchDraft = useCallback(
    (patch: Partial<RemoteConfigDraft>) =>
      setDraft((prev) => ({ ...prev, ...patch })),
    [],
  );

  const save = useCallback(async () => {
    try {
      await updateMut.mutateAsync(draft);
      pushToast({ kind: 'success', message: t('remote.toastSaved') });
      setShowForm(false);
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('remote.toastSaveFailed', { message: (e as Error).message }),
      });
    }
  }, [draft, pushToast, t, updateMut]);

  const resetForm = useCallback(() => {
    setDraft(emptyRemoteDraft(cfgQ.data));
  }, [cfgQ.data]);

  // ── SSH 远程开发 ──
  const navigate = useNavigate();
  const hostsQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'ssh-hosts'],
    queryFn: () => reflect_remote_hosts(),
    staleTime: REMOTE_STALE_MS,
  });
  const sessionsQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'ssh-sessions'],
    queryFn: () => reflect_remote_sessions(),
    refetchInterval: 10_000,
  });
  const [sshForm, setSshForm] = useState<SshConnectDraft>({
    name: '',
    host: '',
    port: null,
    user: '',
    cwd: '',
  });
  const patchSshConnectForm = useCallback(
    (patch: Partial<SshConnectDraft>) => setSshForm((prev) => ({ ...prev, ...patch })),
    [],
  );
  const invalidateSsh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY, 'ssh-hosts'] });
    void qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY, 'ssh-sessions'] });
  }, [qc]);

  const sshSaveHostMut = useMutation({
    mutationFn: () =>
      reflect_remote_host_save({
        name: sshForm.name,
        host: sshForm.host,
        port: sshForm.port ?? undefined,
        user: sshForm.user || undefined,
      }),
    onSuccess: () => {
      invalidateSsh();
      pushToast({ kind: 'success', message: t('remote.ssh.saved') });
    },
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshSaveHost = useCallback(async () => {
    await sshSaveHostMut.mutateAsync();
  }, [sshSaveHostMut]);

  const sshRemoveHostMut = useMutation({
    mutationFn: (name: string) => reflect_remote_host_remove(name),
    onSuccess: invalidateSsh,
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshRemoveHost = useCallback(
    async (name: string) => {
      await sshRemoveHostMut.mutateAsync(name);
    },
    [sshRemoveHostMut],
  );

  const sshTestMut = useMutation({
    mutationFn: () =>
      reflect_remote_test({
        host: sshForm.host,
        port: sshForm.port ?? undefined,
        user: sshForm.user || undefined,
      }),
    onSuccess: (version) =>
      pushToast({ kind: 'success', message: t('remote.ssh.testOk', { version }) }),
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshTest = useCallback(async () => {
    await sshTestMut.mutateAsync();
  }, [sshTestMut]);

  // 连接 = reflect_remote_connect(握手)→ bind → 前台插槽置位 →
  // 导航 /chat/<sid>:ChatView 挂载 bind 对远程 sid 短路(后端清形)。
  const sshConnectMut = useMutation({
    mutationFn: () => reflect_remote_connect(sshForm.name, sshForm.cwd),
    onSuccess: async (sid) => {
      invalidateSsh();
      pushToast({ kind: 'success', message: t('remote.ssh.connected') });
      // 进入远程会话 = 导航 /chat/<sid>:ChatView 挂载 bind 对远程 sid
      // 短路(后端置前台插槽)。无 router 上下文(能力覆盖层/测试)时跳过。
      try {
        void navigate({ to: '/chat/$sessionId', params: { sessionId: sid } });
      } catch {
        // 测试环境无 router:navigate 同步抛错,吞掉即可。
      }
    },
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshConnect = useCallback(async () => {
    await sshConnectMut.mutateAsync();
  }, [sshConnectMut]);

  const sshDisconnectMut = useMutation({
    mutationFn: (sid: string) => reflect_remote_disconnect(sid),
    onSuccess: invalidateSsh,
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshDisconnect = useCallback(
    async (sid: string) => {
      await sshDisconnectMut.mutateAsync(sid);
    },
    [sshDisconnectMut],
  );

  return {
    config: cfgQ.data ?? null,
    status: statusQ.data ?? null,
    tailscale: tsQ.data ?? null,
    previewCmd: previewQ.data ?? null,
    loading: cfgQ.isLoading || tsQ.isLoading,
    error: cfgQ.error,
    refetch: () => {
      void cfgQ.refetch();
      void statusQ.refetch();
      void tsQ.refetch();
    },

    showForm,
    toggleShowForm,
    draft,
    patchDraft,

    save,
    resetForm,

    isMutating: updateMut.isPending,

    // v1.11 基建#12:远程网页访问状态服务器。
    statusServerPort: serverQ.data ?? null,
    startServer,
    stopServer,
    serverBusy: startServerMut.isPending || stopServerMut.isPending,

    // SSH 远程开发。
    sshHosts: hostsQ.data ?? [],
    sshSessions: sessionsQ.data ?? [],
    sshConnectForm: sshForm,
    patchSshConnectForm,
    sshSaveHost,
    sshRemoveHost,
    sshTest,
    sshConnect,
    sshDisconnect,
    sshBusy: sshConnectMut.isPending || sshDisconnectMut.isPending,
    sshTesting: sshTestMut.isPending,
  };
}