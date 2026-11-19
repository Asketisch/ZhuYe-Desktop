/**
 * useSquadController —— Squad + Leader 委派控制器 (Phase 3 条目 11).
 *
 * 数据源:
 * - `reflect_list_squads` —— 所有 squad 列表(主列表)。
 * - `reflect_list_tasks(name)` —— 所选 squad 下的任务(`list_id = squad_name`)。
 * - `reflect_delegate_next` —— leader 认领下一个 Pending 任务。
 * - `reflect_assign_squad_task` —— 把任务分配给具体成员(更新 owner + metadata.actor)。
 *
 * 与 tasks-board 不同,squad 视图把"leader 委派"作为顶 UX:每行有
 * "Delegate" 按钮触发原子认领;选中 squad 后可看到该 squad 下的任务列表。
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_list_squads,
  reflect_create_squad,
  reflect_delete_squad,
  reflect_delegate_next,
  reflect_assign_squad_task,
  type ReflectSquadSpec,
  type ReflectSquadMember,
} from '@/utils/commands/squad';
import { reflect_list_tasks, type ReflectTask } from '@/utils/commands/tasks';
import type { ReflectActor } from '@/utils/commands/activity';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';

export const SQUADS_QUERY_KEY = ['squads'] as const;
const SQUADS_STALE_MS = 30_000;

export interface SquadController {
  /** 所有 squad(按 createdAtMs 升序)。 */
  squads: ReflectSquadSpec[];
  /** 当前选中的 squad name(空 = 全 squad 视角)。 */
  selectedName: string;
  setSelectedName: (n: string) => void;
  /** 当前选中 squad 的 spec。 */
  selectedSquad: ReflectSquadSpec | null;
  /** 当前选中 squad 下的任务(`list_id = squadName`)。 */
  squadTasks: ReflectTask[];
  /** 创建表单状态。 */
  draftName: string;
  setDraftName: (v: string) => void;
  draftDescription: string;
  setDraftDescription: (v: string) => void;
  draftMembers: ReflectSquadMember[];
  setDraftMembers: (ms: ReflectSquadMember[]) => void;
  /** Mutations。 */
  create: () => Promise<void>;
  remove: (name: string) => Promise<void>;
  delegateNext: () => Promise<void>;
  assignTask: (taskId: number, assignee: string | null) => Promise<void>;
  loading: boolean;
  isMutating: boolean;
}

function leaderActor(name: string): ReflectActor {
  return {
    actorType: 'agent',
    actorId: `team-lead@${name}`,
    kind: 'lead',
    displayName: 'Lead',
    teamName: name,
  };
}

export function useSquadController(): SquadController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { t } = useI18n();
  const [selectedName, setSelectedName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftMembers, setDraftMembers] = useState<ReflectSquadMember[]>([]);

  const squadsQ = useQuery({
    queryKey: [...SQUADS_QUERY_KEY] as const,
    queryFn: () => reflect_list_squads(),
    staleTime: SQUADS_STALE_MS,
  });

  const tasksQ = useQuery({
    queryKey: [...SQUADS_QUERY_KEY, 'tasks', selectedName] as const,
    queryFn: () => reflect_list_tasks(selectedName),
    enabled: !!selectedName,
    staleTime: SQUADS_STALE_MS,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const spec: ReflectSquadSpec = {
        name: draftName,
        description: draftDescription || null,
        leaderActor: leaderActor(draftName),
        members: draftMembers,
        createdAtMs: 0,
      };
      await reflect_create_squad(spec);
    },
    onSuccess: () => {
      pushToast({ kind: 'success', message: t('squad.toastCreated', { name: draftName }) });
      qc.invalidateQueries({ queryKey: [...SQUADS_QUERY_KEY] });
      setDraftName('');
      setDraftDescription('');
      setDraftMembers([]);
      setSelectedName(draftName);
    },
    onError: (e) => pushToast({ kind: 'error', message: String(e) }),
  });

  const removeMut = useMutation({
    mutationFn: (name: string) => reflect_delete_squad(name),
    onSuccess: () => {
      pushToast({ kind: 'success', message: t('squad.toastDeleted') });
      qc.invalidateQueries({ queryKey: [...SQUADS_QUERY_KEY] });
      if (selectedName) setSelectedName('');
    },
    onError: (e) => pushToast({ kind: 'error', message: String(e) }),
  });

  const delegateMut = useMutation({
    mutationFn: async () => {
      const claimed = await reflect_delegate_next(selectedName, `team-lead@${selectedName}`);
      return claimed;
    },
    onSuccess: (claimed) => {
      qc.invalidateQueries({ queryKey: [...SQUADS_QUERY_KEY, 'tasks', selectedName] });
      if (claimed) pushToast({ kind: 'success', message: t('squad.toastClaimed', { id: claimed.id }) });
      else pushToast({ kind: 'warn', message: t('squad.toastNoPending') });
    },
    onError: (e) => pushToast({ kind: 'error', message: String(e) }),
  });

  const assignMut = useMutation({
    mutationFn: async (args: { taskId: number; assignee: string | null }) => {
      await reflect_assign_squad_task(selectedName, args.taskId, args.assignee);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...SQUADS_QUERY_KEY, 'tasks', selectedName] });
      pushToast({
        kind: 'success',
        message: vars.assignee ? t('squad.toastAssigned', { assignee: vars.assignee }) : t('squad.toastUnassigned'),
      });
    },
    onError: (e) => pushToast({ kind: 'error', message: String(e) }),
  });

  const squads = useMemo(() => squadsQ.data ?? [], [squadsQ.data]);
  const selectedSquad = useMemo(() => {
    return squads.find((s) => s.name === selectedName) ?? null;
  }, [squads, selectedName]);

  const create = useCallback(async () => {
    await createMut.mutateAsync();
  }, [createMut]);

  const remove = useCallback(async (name: string) => {
    await removeMut.mutateAsync(name);
  }, [removeMut]);

  const delegateNext = useCallback(async () => {
    if (!selectedName) return;
    await delegateMut.mutateAsync();
  }, [delegateMut, selectedName]);

  const assignTask = useCallback(
    async (taskId: number, assignee: string | null) => {
      if (!selectedName) return;
      await assignMut.mutateAsync({ taskId, assignee });
    },
    [assignMut, selectedName],
  );

  return {
    squads,
    selectedName,
    setSelectedName,
    selectedSquad,
    squadTasks: tasksQ.data ?? [],
    draftName,
    setDraftName,
    draftDescription,
    setDraftDescription,
    draftMembers,
    setDraftMembers,
    create,
    remove,
    delegateNext,
    assignTask,
    loading: squadsQ.isLoading,
    isMutating:
      createMut.isPending ||
      removeMut.isPending ||
      delegateMut.isPending ||
      assignMut.isPending,
  };
}
