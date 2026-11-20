/**
 * Agents controller hook（阶段 1 任务 3）。
 *
 * 职责：
 *   - TanStack `useQuery` 用于 `zhuye_list_agent_defs`
 *   - 三个 mutation：save / delete / parse-preview
 *   - 编辑器状态（草稿 def + 原始 markdown 模式切换）
 *
 * 参考 `useMemoryController` / `useTasksBoardController` 的模式。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zhuye_delete_agent_def,
  zhuye_get_active_agent,
  zhuye_list_agent_defs,
  zhuye_save_agent_def,
  zhuye_set_active_agent,
  type ActiveAgentInfo,
  type ZhuyeAgentDef,
} from '@/utils/commands';

export type { ZhuyeAgentDef, ZhuyeMemoryScope } from '@/utils/commands';
export type { ActiveAgentInfo } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';

export const AGENTS_QUERY_KEY = ['agent-defs'] as const;
export const ACTIVE_AGENT_QUERY_KEY = ['active-agent'] as const;
const AGENTS_STALE_MS = 30_000;

/** 创建表单的空草稿。 */
export function emptyAgentDraft(): ZhuyeAgentDef {
  return {
    name: '',
    description: '',
    spawnable: false,
    readonly: false,
    tools: [],
    disallowed_tools: [],
    model: null,
    max_turns: null,
    memory: [],
    mcp_collections: [],
    system_prompt: '',
    // v1.6:新建的 agent 是文件型定义 → 上游 parser 恒置 Custom。
    source: 'custom',
  };
}

export interface AgentsController {
  // 查询
  defs: ZhuyeAgentDef[];
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // 编辑器状态
  draft: ZhuyeAgentDef | null;
  isEditing: boolean;
  isCreating: boolean;
  beginCreate: () => void;
  beginEdit: (def: ZhuyeAgentDef) => void;
  cancelEdit: () => void;
  patchDraft: (patch: Partial<ZhuyeAgentDef>) => void;

  // 突变操作
  save: () => Promise<void>;
  remove: (def: ZhuyeAgentDef) => Promise<void>;

  // 活跃 agent(决定运行时加载哪条定义 + 记忆目录)
  activeAgent: ActiveAgentInfo | null;
  /** 切换活跃 agent(后端会 replay 历史并强制重绑当前会话)。 */
  setActiveAgent: (name: string) => Promise<void>;
  /** 切换是否进行中。 */
  isSwitchingAgent: boolean;

  isMutating: boolean;
}

export function useAgentsController(): AgentsController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);

  const [draft, setDraft] = useState<ZhuyeAgentDef | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const editorGeneration = useRef(0);
  const saving = useRef(false);

  const defsQ = useQuery({
    queryKey: [...AGENTS_QUERY_KEY],
    queryFn: () => zhuye_list_agent_defs(),
    staleTime: AGENTS_STALE_MS,
  });

  // 活跃 agent —— 运行时实际加载的那条定义(桌面端此前硬编码,GUI 的
  // Agents 视图是死胡同)。
  const activeQ = useQuery({
    queryKey: [...ACTIVE_AGENT_QUERY_KEY],
    queryFn: () => zhuye_get_active_agent(),
    staleTime: AGENTS_STALE_MS,
  });

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: [...AGENTS_QUERY_KEY] }),
    [qc],
  );

  const saveMut = useMutation({
    mutationFn: ({ def, createOnly }: { def: ZhuyeAgentDef; createOnly: boolean }) => zhuye_save_agent_def(def, createOnly),
    onSuccess: () => void invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: ({ name }: { name: string }) => zhuye_delete_agent_def(name),
    onSuccess: () => void invalidate(),
  });

  const beginCreate = useCallback(() => {
    editorGeneration.current += 1;
    setIsCreating(true);
    setDraft(emptyAgentDraft());
  }, []);
  const beginEdit = useCallback((def: ZhuyeAgentDef) => {
    editorGeneration.current += 1;
    setIsCreating(false);
    setDraft({ ...def });
  }, []);
  const cancelEdit = useCallback(() => {
    editorGeneration.current += 1;
    setIsCreating(false);
    setDraft(null);
  }, []);

  const patchDraft = useCallback((patch: Partial<ZhuyeAgentDef>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch, ...(saving.current ? { name: prev.name } : {}) } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!draft || saving.current) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (!name) {
      pushToast({ kind: 'warn', message: 'Name is required.' });
      return;
    }
    if (!description) {
      pushToast({ kind: 'warn', message: 'Description is required.' });
      return;
    }
    const generation = editorGeneration.current;
    saving.current = true;
    try {
      await saveMut.mutateAsync({ def: { ...draft, name, description }, createOnly: isCreating });
      pushToast({ kind: 'success', message: `Saved agent “${name}”` });
      if (editorGeneration.current === generation) {
        setIsCreating(false);
        setDraft((current) => current === draft ? null : current);
      }
    } catch (e) {
      pushToast({
        kind: 'error',
        message: `Save failed: ${(e as Error).message}`,
      });
    } finally {
      saving.current = false;
    }
  }, [draft, isCreating, pushToast, saveMut]);

  const remove = useCallback(
    async (def: ZhuyeAgentDef) => {
      try {
        const ok = await deleteMut.mutateAsync({ name: def.name });
        pushToast({
          kind: ok ? 'success' : 'warn',
          message: ok ? `Deleted ${def.name}` : `${def.name} not found`,
        });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Delete failed: ${(e as Error).message}`,
        });
      }
    },
    [deleteMut, pushToast],
  );

  const defs = useMemo(() => defsQ.data ?? [], [defsQ.data]);

  const setActiveMut = useMutation({
    mutationFn: (name: string) => zhuye_set_active_agent(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...ACTIVE_AGENT_QUERY_KEY] });
    },
  });

  const setActiveAgent = useCallback(
    async (name: string) => {
      try {
        await setActiveMut.mutateAsync(name);
        pushToast({ kind: 'success', message: `Active agent → ${name}` });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `Switch agent failed: ${(e as Error).message}`,
        });
      }
    },
    [pushToast, setActiveMut],
  );

  return {
    defs,
    loading: defsQ.isLoading,
    error: defsQ.error,
    refetch: defsQ.refetch,

    draft,
    isEditing: draft !== null,
    isCreating,
    beginCreate,
    beginEdit,
    cancelEdit,
    patchDraft,

    save,
    remove,

    activeAgent: activeQ.data ?? null,
    setActiveAgent,
    isSwitchingAgent: setActiveMut.isPending,

    isMutating: saveMut.isPending || deleteMut.isPending,
  };
}

/** tools / disallowed_tools 列表编辑器的逗号分隔辅助函数。 */
export function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinCsv(list: string[]): string {
  return list.join(', ');
}
