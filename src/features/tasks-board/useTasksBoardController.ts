/**
 * Tasks board —— controller hook（阶段 1 多 agent UI）。
 *
 * 封装查询 / 突变编排，使视图保持纯展示。职责：
 *   - TanStack `useQuery` 用于 `reflect_list_tasks`（轮询活动列表）
 *   - `useQuery` 用于 `reflect_list_teams`（驱动列表选择器：选择 team 时
 *     list id = team 名称，否则为自由文本）
 *   - 四个 mutation：create / claim / update(status) / delete，各带 toast
 *     + cache 失效
 *   - 视图模式（list / board）+ 活动列表 id + 创建表单 UI 状态。
 *
 * 参考 `useMemoryController` 的结构（2026-07-25 重构先例）。
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_claim_task,
  reflect_create_task,
  reflect_delete_task,
  reflect_delete_team,
  reflect_list_tasks,
  reflect_list_teams,
  reflect_release_task,
  reflect_stop_task,
  reflect_update_task,
  reflect_upsert_team,
  type ReflectTask,
  type ReflectTaskStatus,
  type ReflectTeam,
} from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';

export const TASKS_QUERY_KEY_BASE = ['tasks'] as const;
const TASKS_STALE_MS = 15_000;
const TEAMS_STALE_MS = 60_000;

/** 未选择 team / 自定义列表时的默认列表 ID。 */
export const DEFAULT_LIST_ID = 'default';

export type BoardView = 'list' | 'board';

export const STATUS_ORDER: ReflectTaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'deleted',
];

/** 旧版 —— 请改用 i18n `tasks.*` key。保留用于向后兼容。 */
export const STATUS_LABELS: Record<ReflectTaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  deleted: 'Deleted',
};

export interface TasksBoardController {
  // 任务查询
  tasks: ReflectTask[];
  /** 按状态分组（board 视图）。排除软删除的任务。 */
  grouped: Record<ReflectTaskStatus, ReflectTask[]>;
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // Team 查询(驱动列表选择器)
  teamNames: string[];
  /** 团队全量数据(团队编辑器用)。 */
  teams: ReflectTeam[];
  /** 保存团队(核心 `upsert_team`)。失败时抛错,由编辑器展示。 */
  upsertTeam: (team: ReflectTeam) => Promise<void>;
  /** 删除团队(核心 `delete_team`)。失败时抛错。 */
  deleteTeam: (name: string) => Promise<void>;
  /** 团队写操作进行中。 */
  teamBusy: boolean;

  // 视图 + 列表状态
  view: BoardView;
  setView: (v: BoardView) => void;
  listId: string;
  setListId: (id: string) => void;

  // 创建表单状态
  showForm: boolean;
  toggleShowForm: () => void;
  newSubject: string;
  setNewSubject: (v: string) => void;
  newDescription: string;
  setNewDescription: (v: string) => void;
  newOwner: string;
  setNewOwner: (v: string) => void;

  // 突变操作
  create: () => Promise<void>;
  claim: (task: ReflectTask) => Promise<void>;
  advance: (task: ReflectTask, status: ReflectTaskStatus) => Promise<void>;
  remove: (task: ReflectTask) => Promise<void>;
  /** 停止进行中的任务(与核心 `TaskStopTool` 同语义)。 */
  stop: (task: ReflectTask) => Promise<void>;
  /** 释放已认领的任务(与核心 `TaskReleaseTool` 同语义)。 */
  release: (task: ReflectTask) => Promise<void>;

  // 详情抽屉(产出 / 描述)
  /** 当前展开详情的任务(null = 未展开)。 */
  selected: ReflectTask | null;
  selectTask: (task: ReflectTask | null) => void;

  isMutating: boolean;
}

function tasksQueryKey(listId: string): readonly unknown[] {
  return [...TASKS_QUERY_KEY_BASE, listId] as const;
}

export function useTasksBoardController(): TasksBoardController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);

  const [view, setView] = useState<BoardView>('list');
  const [listId, setListId] = useState<string>(DEFAULT_LIST_ID);
  const [showForm, setShowForm] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newOwner, setNewOwner] = useState('');

  const tasksQ = useQuery({
    queryKey: tasksQueryKey(listId),
    queryFn: () => reflect_list_tasks(listId),
    staleTime: TASKS_STALE_MS,
  });

  const teamsQ = useQuery({
    queryKey: ['teams'],
    queryFn: () => reflect_list_teams(),
    staleTime: TEAMS_STALE_MS,
  });

  const invalidateTasks = useCallback(
    () => qc.invalidateQueries({ queryKey: [...TASKS_QUERY_KEY_BASE] }),
    [qc],
  );

  const createMut = useMutation({
    mutationFn: (args: {
      list: string;
      subject: string;
      description: string;
      owner?: string;
    }) =>
      reflect_create_task({
        list: args.list,
        subject: args.subject,
        description: args.description,
        owner: args.owner ?? null,
      }),
    onSuccess: () => void invalidateTasks(),
  });

  const claimMut = useMutation({
    mutationFn: ({ list, claimer }: { list: string; claimer: string }) =>
      reflect_claim_task(list, claimer),
    onSuccess: () => void invalidateTasks(),
  });

  const updateMut = useMutation({
    mutationFn: ({
      list,
      id,
      patch,
    }: {
      list: string;
      id: number;
      patch: { status: ReflectTaskStatus };
    }) => reflect_update_task(list, id, patch),
    onSuccess: () => void invalidateTasks(),
  });

  const deleteMut = useMutation({
    mutationFn: ({ list, id }: { list: string; id: number }) =>
      reflect_delete_task(list, id),
    onSuccess: () => void invalidateTasks(),
  });

  // 停止 / 释放 —— 与核心 `TaskStopTool` / `TaskReleaseTool` 同款命令
  // (守卫在命令层,不在前端重复实现)。
  const stopMut = useMutation({
    mutationFn: ({ list, id }: { list: string; id: number }) =>
      reflect_stop_task(list, id),
    onSuccess: () => void invalidateTasks(),
  });

  const releaseMut = useMutation({
    mutationFn: ({ list, id }: { list: string; id: number }) =>
      reflect_release_task(list, id),
    onSuccess: () => void invalidateTasks(),
  });

  // 团队建 / 改 / 删 —— 核心 `TaskManager::upsert_team` / `delete_team`。
  const upsertTeamMut = useMutation({
    mutationFn: (team: ReflectTeam) => reflect_upsert_team(team),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teams'] }),
  });

  const deleteTeamMut = useMutation({
    mutationFn: (name: string) => reflect_delete_team(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teams'] }),
  });

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);

  const grouped = useMemo<Record<ReflectTaskStatus, ReflectTask[]>>(() => {
    const init: Record<ReflectTaskStatus, ReflectTask[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      deleted: [],
    };
    for (const t of tasks) {
      init[t.status].push(t);
    }
    return init;
  }, [tasks]);

  const teamNames = useMemo(
    () => (teamsQ.data ?? []).map((tm) => tm.name).sort(),
    [teamsQ.data],
  );

  const toggleShowForm = useCallback(() => setShowForm((v) => !v), []);

  const create = useCallback(async () => {
    const subject = newSubject.trim();
    if (!subject) {
      pushToast({ kind: 'warn', message: 'Subject is required.' });
      return;
    }
    try {
      await createMut.mutateAsync({
        list: listId,
        subject,
        description: newDescription.trim(),
        owner: newOwner.trim() || undefined,
      });
      pushToast({ kind: 'success', message: `Created “${subject}”` });
      setNewSubject('');
      setNewDescription('');
      setNewOwner('');
      setShowForm(false);
    } catch (e) {
      pushToast({
        kind: 'error',
        message: `Create failed: ${(e as Error).message}`,
      });
    }
  }, [createMut, listId, newDescription, newOwner, newSubject, pushToast]);

  const claim = useCallback(
    async (task: ReflectTask) => {
      // 在任务自身列表下 claim（即使用户切换了 listId 也能正常工作）。
      const claimer = newOwner.trim() || 'desktop-user';
      try {
        const claimed = await claimMut.mutateAsync({
          list: task.list_id,
          claimer,
        });
        if (claimed) {
          pushToast({
            kind: 'success',
            message: `Claimed #${claimed.id} “${claimed.subject}”`,
          });
        } else {
          pushToast({
            kind: 'warn',
            message: 'No claimable task (queue empty or all blocked).',
          });
        }
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Claim failed: ${(e as Error).message}`,
        });
      }
    },
    [claimMut, newOwner, pushToast],
  );

  const advance = useCallback(
    async (task: ReflectTask, status: ReflectTaskStatus) => {
      try {
        await updateMut.mutateAsync({
          list: task.list_id,
          id: task.id,
          patch: { status },
        });
        pushToast({
          kind: 'success',
          message: `#${task.id} → ${STATUS_LABELS[status]}`,
        });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Update failed: ${(e as Error).message}`,
        });
      }
    },
    [updateMut, pushToast],
  );

  const remove = useCallback(
    async (task: ReflectTask) => {
      try {
        await deleteMut.mutateAsync({ list: task.list_id, id: task.id });
        pushToast({ kind: 'success', message: `Deleted #${task.id}` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Delete failed: ${(e as Error).message}`,
        });
      }
    },
    [deleteMut, pushToast],
  );

  const stop = useCallback(
    async (task: ReflectTask) => {
      try {
        await stopMut.mutateAsync({ list: task.list_id, id: task.id });
        pushToast({ kind: 'success', message: `Stopped #${task.id}` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Stop failed: ${(e as Error).message}`,
        });
      }
    },
    [pushToast, stopMut],
  );

  const release = useCallback(
    async (task: ReflectTask) => {
      try {
        await releaseMut.mutateAsync({ list: task.list_id, id: task.id });
        pushToast({ kind: 'success', message: `Released #${task.id}` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Release failed: ${(e as Error).message}`,
        });
      }
    },
    [pushToast, releaseMut],
  );

  const [selected, setSelected] = useState<ReflectTask | null>(null);

  /** 团队全量数据(团队编辑器用)。 */
  const teams = useMemo(() => teamsQ.data ?? [], [teamsQ.data]);

  const upsertTeam = useCallback(
    async (team: ReflectTeam) => {
      try {
        await upsertTeamMut.mutateAsync(team);
        pushToast({ kind: 'success', message: `Saved team “${team.name}”` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Save team failed: ${(e as Error).message}`,
        });
        throw e;
      }
    },
    [pushToast, upsertTeamMut],
  );

  const deleteTeam = useCallback(
    async (name: string) => {
      try {
        await deleteTeamMut.mutateAsync(name);
        pushToast({ kind: 'success', message: `Deleted team “${name}”` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Delete team failed: ${(e as Error).message}`,
        });
        throw e;
      }
    },
    [deleteTeamMut, pushToast],
  );

  return {
    tasks,
    grouped,
    loading: tasksQ.isLoading,
    error: tasksQ.error,
    refetch: tasksQ.refetch,

    teamNames,
    teams,
    upsertTeam,
    deleteTeam,
    teamBusy: upsertTeamMut.isPending || deleteTeamMut.isPending,

    view,
    setView,
    listId,
    setListId,

    showForm,
    toggleShowForm,
    newSubject,
    setNewSubject,
    newDescription,
    setNewDescription,
    newOwner,
    setNewOwner,

    create,
    claim,
    advance,
    remove,
    stop,
    release,

    selected,
    selectTask: setSelected,

    isMutating:
      createMut.isPending ||
      claimMut.isPending ||
      updateMut.isPending ||
      deleteMut.isPending ||
      stopMut.isPending ||
      releaseMut.isPending,
  };
}
