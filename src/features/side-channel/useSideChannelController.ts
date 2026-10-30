/**
 * Side-channel controller hook（阶段 2 任务 1）。
 *
 * 封装查询 / 突变编排：
 *   - TanStack `useQuery` 用于 `reflect_list_side_channels`（实时更新
 *     依赖 broadcast 事件流，目前为焦点恢复 + 每次 mutation 后的快照刷新）。
 *   - 两个 mutation：start / cancel，带 toast + cache 失效。
 *
 * 参考 `useMemoryController` / `useTasksBoardController` 的模式。
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_cancel_side_channel,
  reflect_list_side_channels,
  reflect_start_side_channel,
  type ReflectSideChannelInfo,
  type ReflectStartSideChannelResult,
} from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';

export const SIDECHANNEL_QUERY_KEY = ['side-channels'] as const;
const SIDECHANNEL_STALE_MS = 5_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

export interface SideChannelController {
  // 查询
  channels: ReflectSideChannelInfo[];
  runningCount: number;
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // 启动表单状态
  showForm: boolean;
  toggleShowForm: () => void;
  agentName: string;
  setAgentName: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;

  // 突变操作
  start: () => Promise<void>;
  cancel: (id: string) => Promise<void>;

  isMutating: boolean;
}

export function useSideChannelController(): SideChannelController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { t } = useI18n();

  const [showForm, setShowForm] = useState(false);
  const [agentName, setAgentName] = useState('default');
  const [prompt, setPrompt] = useState('');

  const channelsQ = useQuery({
    queryKey: [...SIDECHANNEL_QUERY_KEY],
    queryFn: () => reflect_list_side_channels(),
    staleTime: SIDECHANNEL_STALE_MS,
    refetchInterval: SIDECHANNEL_STALE_MS,
  });

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: [...SIDECHANNEL_QUERY_KEY] }),
    [qc],
  );

  const startMut = useMutation({
    mutationFn: (args: { agent_name: string; prompt: string }) =>
      reflect_start_side_channel(args),
    onSuccess: (res: ReflectStartSideChannelResult) => {
      void invalidate();
      pushToast({
        kind: 'success',
        message: t('sideChannel.toastStarted', { id: res.id }),
      });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => reflect_cancel_side_channel(id),
    onSuccess: (ok: boolean, id: string) => {
      void invalidate();
      pushToast({
        kind: ok ? 'success' : 'warn',
        message: ok
          ? t('sideChannel.toastCancelled', { id })
          : t('sideChannel.toastAlreadyFinished', { id }),
      });
    },
  });

  const toggleShowForm = useCallback(() => setShowForm((v) => !v), []);

  const start = useCallback(async () => {
    const trimmedName = agentName.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) {
      pushToast({ kind: 'warn', message: t('sideChannel.errorNameRequired') });
      return;
    }
    if (!trimmedPrompt) {
      pushToast({ kind: 'warn', message: t('sideChannel.errorPromptRequired') });
      return;
    }
    try {
      await startMut.mutateAsync({ agent_name: trimmedName, prompt: trimmedPrompt });
      setPrompt('');
      setShowForm(false);
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('sideChannel.errorStart', { message: errorMessage(e) }),
      });
    }
  }, [agentName, prompt, pushToast, startMut, t]);

  const cancel = useCallback(
    async (id: string) => {
      try {
        await cancelMut.mutateAsync(id);
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('sideChannel.errorCancel', { message: errorMessage(e) }),
        });
      }
    },
    [cancelMut, pushToast, t],
  );

  const channels = channelsQ.data ?? [];
  const runningCount = channels.filter((c) => c.status === 'running').length;

  return {
    channels,
    runningCount,
    loading: channelsQ.isLoading,
    error: channelsQ.error,
    refetch: channelsQ.refetch,

    showForm,
    toggleShowForm,
    agentName,
    setAgentName,
    prompt,
    setPrompt,

    start,
    cancel,

    isMutating: startMut.isPending || cancelMut.isPending,
  };
}
