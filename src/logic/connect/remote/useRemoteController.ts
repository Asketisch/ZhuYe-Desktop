/**
 * Remote controller hook（阶段 2 任务 2）。
 *
 * 拥有 TanStack 查询 + 突变：
 *   - `zhuye_get_remote_config` / `zhuye_update_remote_config`
 *   - `zhuye_get_remote_status`
 *   - `zhuye_tailscale_status`
 *   - `zhuye_tailscale_daemon_command_preview`
 *
 * `start/stop/status` daemon 命令已存在，以便 iOS 设置卡片可以展示
 * "尚未实现" 的占位符而不产生 TypeScript 错误；controller 不会自动调用它们。
 */
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zhuye_get_remote_config,
  zhuye_get_remote_status,
  zhuye_status_server_start,
  zhuye_status_server_state,
  zhuye_status_server_stop,
  zhuye_tailscale_daemon_command_preview,
  zhuye_tailscale_status,
  zhuye_update_remote_config,
  zhuye_remote_hosts,
  zhuye_remote_host_remove,
  zhuye_remote_host_save,
  zhuye_remote_sessions,
  zhuye_remote_test,
  zhuye_remote_connect,
  zhuye_remote_disconnect,
  zhuye_remote_bootstrap,
  type ZhuyeRemoteConfigSnapshot,
  type ZhuyeRemoteHost,
  type ZhuyeRemoteSessionInfo,
  type ZhuyeRemoteStatus,
  type ZhuyeTailscaleStatus,
} from '@/utils/commands';
import { useNavigate } from '@tanstack/react-router';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';

export const REMOTE_QUERY_KEY = ['remote'] as const;
const REMOTE_STALE_MS = 15_000;

export interface RemoteController {
  // 查询
  config: ZhuyeRemoteConfigSnapshot | null;
  status: ZhuyeRemoteStatus | null;
  tailscale: ZhuyeTailscaleStatus | null;
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
  sshHosts: ZhuyeRemoteHost[];
  sshSessions: ZhuyeRemoteSessionInfo[];
  sshConnectForm: SshConnectDraft;
  patchSshConnectForm: (patch: Partial<SshConnectDraft>) => void;
  sshSaveHost: () => Promise<void>;
  sshRemoveHost: (name: string) => Promise<void>;
  sshTest: () => Promise<void>;
  sshConnect: () => Promise<void>;
  sshDisconnect: (sid: string) => Promise<void>;
  sshBootstrap: () => Promise<void>;
  sshBusy: boolean;
  sshTesting: boolean;
  sshBooting: boolean;
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

export function emptyRemoteDraft(c?: ZhuyeRemoteConfigSnapshot | null): RemoteConfigDraft {
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
    queryFn: () => zhuye_get_remote_config(),
    staleTime: REMOTE_STALE_MS,
  });

  const statusQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'status'],
    queryFn: () => zhuye_get_remote_status(),
    staleTime: REMOTE_STALE_MS,
  });

  const tsQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'tailscale'],
    queryFn: () => zhuye_tailscale_status(),
    staleTime: REMOTE_STALE_MS,
  });

  const previewQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'preview'],
    queryFn: () => zhuye_tailscale_daemon_command_preview(),
    staleTime: Infinity,
  });

  // v1.11 基建#12:远程网页访问状态服务器。
  const serverQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'status-server'],
    queryFn: () => zhuye_status_server_state(),
    staleTime: 5_000,
  });
  const startServerMut = useMutation({
    mutationFn: (port: number) => zhuye_status_server_start(port),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...REMOTE_QUERY_KEY, 'status-server'] }),
    onError: () => undefined,
  });
  const stopServerMut = useMutation({
    mutationFn: () => zhuye_status_server_stop(),
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
      zhuye_update_remote_config({
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
    queryFn: () => zhuye_remote_hosts(),
    staleTime: REMOTE_STALE_MS,
  });
  const sessionsQ = useQuery({
    queryKey: [...REMOTE_QUERY_KEY, 'ssh-sessions'],
    queryFn: () => zhuye_remote_sessions(),
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
      zhuye_remote_host_save({
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
    mutationFn: (name: string) => zhuye_remote_host_remove(name),
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
      zhuye_remote_test({
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

  // 连接 = zhuye_remote_connect(握手)→ bind → 前台插槽置位 →
  // 导航 /chat/<sid>:ChatView 挂载 bind 对远程 sid 短路(后端清形)。
  const sshConnectMut = useMutation({
    mutationFn: () => zhuye_remote_connect(sshForm.name, sshForm.cwd),
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
    mutationFn: (sid: string) => zhuye_remote_disconnect(sid),
    onSuccess: invalidateSsh,
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshDisconnect = useCallback(
    async (sid: string) => {
      await sshDisconnectMut.mutateAsync(sid);
    },
    [sshDisconnectMut],
  );

  // 一键安装:远端无 zhuye CLI 时(测试主机报错后)使用;装完自动重测。
  const sshBootstrapMut = useMutation({
    mutationFn: () => zhuye_remote_bootstrap(sshForm.name),
    onSuccess: async (version) => {
      pushToast({ kind: 'success', message: t('remote.ssh.bootstrapOk', { version }) });
      // 装完即验证可达性,让用户直接 connect。
      try {
        await sshTestMut.mutateAsync();
      } catch {
        // 重测失败信息已由 sshTestMut 的 onError toast,不再叠加。
      }
    },
    onError: (e) => pushToast({ kind: 'error', message: (e as Error).message }),
  });
  const sshBootstrap = useCallback(async () => {
    await sshBootstrapMut.mutateAsync();
  }, [sshBootstrapMut]);

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
    sshBootstrap,
    sshBusy: sshConnectMut.isPending || sshDisconnectMut.isPending,
    sshTesting: sshTestMut.isPending,
    sshBooting: sshBootstrapMut.isPending,
  };
}