/**
 * Schedule controller hook（阶段 1 任务 2）。
 *
 * 职责：
 *   - TanStack `useQuery` 用于 `reflect_list_schedules` + `reflect_get_schedule_status`
 *   - 三个 mutation：add / update / remove，各带 toast + cache 失效
 *   - 创建表单 UI 状态（schedule / prompt / name）
 *
 * 参考 `useMemoryController` / `useTasksBoardController` 的模式。
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_add_schedule,
  reflect_get_schedule_status,
  reflect_list_schedules,
  reflect_remove_schedule,
  reflect_update_schedule,
  type ReflectCronJob,
  type ReflectScheduleStatus,
} from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';

export const SCHEDULE_QUERY_KEY = ['schedules'] as const;
const SCHEDULE_STALE_MS = 15_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

export interface ScheduleController {
  // 查询
  jobs: ReflectCronJob[];
  status: ReflectScheduleStatus | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // 创建表单状态
  showForm: boolean;
  toggleShowForm: () => void;
  newSchedule: string;
  setNewSchedule: (v: string) => void;
  newPrompt: string;
  setNewPrompt: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;

  // 突变操作
  create: () => Promise<void>;
  toggle: (job: ReflectCronJob) => Promise<void>;
  remove: (job: ReflectCronJob) => Promise<void>;

  isMutating: boolean;
}

export function useScheduleController(): ScheduleController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { t } = useI18n();

  const [showForm, setShowForm] = useState(false);
  const [newSchedule, setNewSchedule] = useState('0 * * * *');
  const [newPrompt, setNewPrompt] = useState('');
  const [newName, setNewName] = useState('');

  const jobsQ = useQuery({
    queryKey: [...SCHEDULE_QUERY_KEY],
    queryFn: () => reflect_list_schedules(),
    staleTime: SCHEDULE_STALE_MS,
  });

  const statusQ = useQuery({
    queryKey: [...SCHEDULE_QUERY_KEY, 'status'],
    queryFn: () => reflect_get_schedule_status(),
    staleTime: SCHEDULE_STALE_MS,
  });

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: [...SCHEDULE_QUERY_KEY] }),
    [qc],
  );

  const addMut = useMutation({
    mutationFn: (args: { schedule: string; prompt: string; name?: string }) =>
      reflect_add_schedule({
        schedule: args.schedule,
        prompt: args.prompt,
        name: args.name || null,
      }),
    onSuccess: () => void invalidate(),
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: string; enabled?: boolean }) =>
      reflect_update_schedule({ id: args.id, enabled: args.enabled }),
    onSuccess: () => void invalidate(),
  });

  const removeMut = useMutation({
    mutationFn: ({ id }: { id: string }) => reflect_remove_schedule(id),
    onSuccess: () => void invalidate(),
  });

  const toggleShowForm = useCallback(() => setShowForm((v) => !v), []);

  const create = useCallback(async () => {
    const schedule = newSchedule.trim();
    const prompt = newPrompt.trim();
    if (!schedule) {
      pushToast({ kind: 'warn', message: t('schedule.errorCronRequired') });
      return;
    }
    if (!prompt) {
      pushToast({ kind: 'warn', message: t('schedule.errorPromptRequired') });
      return;
    }
    try {
      await addMut.mutateAsync({
        schedule,
        prompt,
        name: newName.trim() || undefined,
      });
      pushToast({ kind: 'success', message: t('schedule.created', { schedule }) });
      setNewPrompt('');
      setNewName('');
      setShowForm(false);
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('schedule.createFailed', { message: errorMessage(e) }),
      });
    }
  }, [addMut, newName, newPrompt, newSchedule, pushToast, t]);

  const toggle = useCallback(
    async (job: ReflectCronJob) => {
      try {
        await updateMut.mutateAsync({ id: job.id, enabled: !job.enabled });
        pushToast({
          kind: 'success',
          message: t(job.enabled ? 'schedule.disabledToast' : 'schedule.enabledToast', { name: job.name ?? job.id }),
        });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('schedule.toggleFailed', { message: errorMessage(e) }),
        });
      }
    },
    [updateMut, pushToast, t],
  );

  const remove = useCallback(
    async (job: ReflectCronJob) => {
      try {
        const removed = await removeMut.mutateAsync({ id: job.id });
        pushToast({ kind: removed ? 'success' : 'warn', message: t(removed ? 'schedule.removed' : 'schedule.alreadyRemoved', { name: job.name ?? job.id }) });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('schedule.removeFailed', { message: errorMessage(e) }),
        });
      }
    },
    [removeMut, pushToast, t],
  );

  return {
    jobs: jobsQ.data ?? [],
    status: statusQ.data ?? null,
    loading: jobsQ.isLoading,
    error: jobsQ.error,
    refetch: jobsQ.refetch,

    showForm,
    toggleShowForm,
    newSchedule,
    setNewSchedule,
    newPrompt,
    setNewPrompt,
    newName,
    setNewName,

    create,
    toggle,
    remove,

    isMutating: addMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}
