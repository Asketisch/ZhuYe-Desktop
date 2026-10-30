/**
 * Memory —— controller hook（B11-01 重构）。
 *
 * 封装查询 / 突变编排，使视图组件保持纯展示。职责：
 *   - TanStack `useQuery` 用于 `reflect_list_memory`
 *   - 三个 mutation（`handleRemove` / `handleEditSave` / `handleAddNew`），
 *     包含 toast + cache 失效
 *   - 过滤 + 编辑 + 新建表单 UI 状态。
 *
 * 从 MemoryView 抽取（2026-07-25）；行为已保留。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_add_memory,
  reflect_list_memory,
  reflect_remove_memory,
  reflect_current_workspace,
  type ReflectMemoryEntry,
  type MemoryContext,
} from '@/utils/commands';
import { reflect_get_active_agent } from '@/utils/commands/agents';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/features/shell/hooks/useCurrentWorkspace';
import { useAgentStore } from '@/stores/agentStore';
import type { LocaleKey } from '@/utils/i18n';
import type { I18nContextValue } from '@/utils/i18n/context';
import { emptyForm, nextDraftRevision, useMemoryDraftStore, type EditDraft, type FormDraft } from './memoryDraftStore';

export const MEMORY_QUERY_KEY = ['memory'] as const;
export const MEMORY_SECTIONS_QUERY_KEY = ['memory-sections'] as const;
const MEMORY_STALE_MS = 30_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

export type Scope = 'user' | 'project' | 'all';

export const SCOPE_KEYS: Record<Scope, LocaleKey> = {
  all: 'memory.scope.all',
  user: 'memory.scope.user',
  project: 'memory.scope.project',
};

export const FILTERS: Scope[] = ['all', 'user', 'project'];

export const NEW_SCOPES: Array<'user' | 'project'> = ['user', 'project'];

export interface MemoryCounts {
  all: number;
  [scope: string]: number;
}

export interface MemoryController {
  // 查询
  context: MemoryContext | null;
  entries: ReflectMemoryEntry[];
  filtered: ReflectMemoryEntry[];
  counts: MemoryCounts;
  loading: boolean;
  error: unknown;
  refetch: () => void;

  // 过滤状态
  filter: Scope;
  setFilter: (s: Scope) => void;

  // 编辑状态
  editingEntry: ReflectMemoryEntry | null;
  savedDrafts: EditDraft[];
  editingKey: string | null;
  editValue: string;
  beginEdit: (entry: ReflectMemoryEntry) => void;
  setEditValue: (v: string) => void;
  cancelEdit: () => void;
  discardEdit: (entry: ReflectMemoryEntry) => void;

  // 新建条目表单状态
  showForm: boolean;
  toggleShowForm: () => void;
  newScope: 'user' | 'project';
  setNewScope: (s: 'user' | 'project') => void;
  newKey: string;
  setNewKey: (v: string) => void;
  newValue: string;
  setNewValue: (v: string) => void;

  // 突变操作
  remove: (entry: ReflectMemoryEntry) => Promise<void>;
  saveEdit: (entry: ReflectMemoryEntry) => Promise<void>;
  addNew: () => Promise<void>;

  // 进行中 mutation 状态（调用方用于禁用控件）。
  isMutating: boolean;
}

export function useMemoryController({ t }: Pick<I18nContextValue, 't'>): MemoryController {
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);

  const [filter, setFilter] = useState<Scope>('all');
  const editSessions = useMemoryDraftStore((state) => state.editSessions);
  const formDrafts = useMemoryDraftStore((state) => state.formDrafts);
  const setEditSessions = useMemoryDraftStore((state) => state.setEditSessions);
  const setFormDrafts = useMemoryDraftStore((state) => state.setFormDrafts);
  const addPending = useRef(false);
  const removePending = useRef(new Set<string>());

  const workspaceQ = useQuery({ queryKey: CURRENT_WORKSPACE_QUERY_KEY, queryFn: reflect_current_workspace, staleTime: MEMORY_STALE_MS });
  const currentWorkspace = workspaceQ.data;
  const activeQ = useQuery({ queryKey: ['active-agent'], queryFn: reflect_get_active_agent, staleTime: MEMORY_STALE_MS });
  const context = useMemo(() => currentWorkspace && activeQ.data?.name
    ? { workspace: currentWorkspace, agent: activeQ.data.name } : null,
  [currentWorkspace, activeQ.data?.name]);
  const contextKey = context ? JSON.stringify([context.workspace, context.agent]) : null;
  const editSession = contextKey ? editSessions[contextKey] : undefined;
  const editDraft = editSession?.activeKey ? editSession.drafts[editSession.activeKey] : undefined;
  const form = contextKey ? formDrafts[contextKey] ?? emptyForm : emptyForm;

  const memQ = useQuery({
    queryKey: [...MEMORY_QUERY_KEY, context],
    queryFn: () => reflect_list_memory(context!),
    enabled: context !== null,
    staleTime: MEMORY_STALE_MS,
  });

  const invalidate = useCallback(
    () => Promise.all([
      qc.invalidateQueries({ queryKey: [...MEMORY_QUERY_KEY] }),
      qc.invalidateQueries({ queryKey: [...MEMORY_SECTIONS_QUERY_KEY] }),
    ]),
    [qc],
  );

  const addMut = useMutation({
    mutationFn: ({ scope, key, value, replaceDocument, createOnly, expectedContext, expectedValue }: { scope: string; key: string; value: string; replaceDocument?: boolean; createOnly?: boolean; expectedContext: MemoryContext; expectedValue?: string }) =>
      reflect_add_memory(scope, key, value, { expectedContext, ...(expectedValue !== undefined ? { expectedValue } : {}), ...(replaceDocument ? { replaceDocument: true } : {}), ...(createOnly ? { createOnly: true } : {}) }),
    onSuccess: () => {
      void invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: ({ scope, key, replaceDocument, expectedContext, expectedValue }: { scope: string; key: string; replaceDocument?: boolean; expectedContext: MemoryContext; expectedValue: string }) =>
      reflect_remove_memory(scope, key, replaceDocument, expectedContext, expectedValue),
    onSuccess: () => {
      void invalidate();
    },
  });

  const entries = memQ.data ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.scope === filter)),
    [entries, filter],
  );

  const counts = useMemo<MemoryCounts>(() => {
    const c: MemoryCounts = { all: entries.length };
    for (const e of entries) {
      c[e.scope] = (c[e.scope] ?? 0) + 1;
    }
    return c;
  }, [entries]);

  const beginEdit = useCallback((entry: ReflectMemoryEntry) => {
    if (!contextKey) return;
    const key = entryKey(entry);
    const revision = nextDraftRevision();
    setEditSessions((sessions) => {
      const current = sessions[contextKey] ?? { activeKey: null, drafts: {} };
      return { ...sessions, [contextKey]: { activeKey: key, drafts: { ...current.drafts, [key]: current.drafts[key] ?? { entry, value: entry.value, revision } } } };
    });
  }, [contextKey, setEditSessions]);

  const setEditValue = useCallback((value: string) => {
    if (!contextKey) return;
    const revision = nextDraftRevision();
    setEditSessions((sessions) => {
      const current = sessions[contextKey];
      const key = current?.activeKey;
      if (!key || !current.drafts[key]) return sessions;
      return { ...sessions, [contextKey]: { ...current, drafts: { ...current.drafts, [key]: { ...current.drafts[key], value, revision } } } };
    });
  }, [contextKey, setEditSessions]);
  const discardEdit = useCallback((entry: ReflectMemoryEntry) => {
    if (!contextKey) return;
    setEditSessions((sessions) => {
      const current = sessions[contextKey];
      const key = entryKey(entry);
      if (!current?.drafts[key]) return sessions;
      const drafts = { ...current.drafts }; delete drafts[key];
      return { ...sessions, [contextKey]: { activeKey: current.activeKey === key ? null : current.activeKey, drafts } };
    });
  }, [contextKey, setEditSessions]);
  const cancelEdit = useCallback(() => { if (editDraft) discardEdit(editDraft.entry); }, [discardEdit, editDraft]);

  const updateForm = useCallback((change: (draft: FormDraft) => Partial<FormDraft>) => {
    if (!contextKey) return;
    const revision = nextDraftRevision();
    setFormDrafts((drafts) => {
      const current = drafts[contextKey] ?? emptyForm;
      return { ...drafts, [contextKey]: { ...current, ...change(current), revision } };
    });
  }, [contextKey, setFormDrafts]);
  const toggleShowForm = useCallback(() => updateForm((draft) => ({ show: !draft.show })), [updateForm]);
  const setNewScope = useCallback((scope: 'user' | 'project') => updateForm(() => ({ scope })), [updateForm]);
  const setNewKey = useCallback((key: string) => updateForm(() => ({ key })), [updateForm]);
  const setNewValue = useCallback((value: string) => updateForm(() => ({ value })), [updateForm]);

  const remove = useCallback(
    async (entry: ReflectMemoryEntry) => {
      const id = `${entry.scope}:${entry.key}`;
      if (removePending.current.has(id)) return;
      removePending.current.add(id);
      try {
        if (!context) throw new Error('Memory context is not available');
        await removeMut.mutateAsync({ scope: entry.scope, key: entry.key, replaceDocument: entry.wholeDocument, expectedContext: context, expectedValue: entry.value });
        pushToast({ kind: 'success', message: t('memory.toast.removed', { key: entry.key }) });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('memory.toast.removeFail', { msg: errorMessage(e) }),
        });
      } finally { removePending.current.delete(id); }
    },
    [context, pushToast, removeMut, t],
  );

  const saveEdit = useCallback(
    async (entry: ReflectMemoryEntry) => {
      if (addPending.current || !contextKey || !context || !editDraft || entryKey(editDraft.entry) !== entryKey(entry)) return;
      const { revision, value, entry: original } = editDraft;
      addPending.current = true;
      try {
        await addMut.mutateAsync({ scope: original.scope, key: original.key, value, replaceDocument: original.wholeDocument, expectedContext: context, expectedValue: original.value });
        pushToast({ kind: 'success', message: t('memory.toast.updated', { key: original.key }) });
        setEditSessions((sessions) => {
          const current = sessions[contextKey];
          const key = entryKey(original);
          const draft = current?.drafts[key];
          if (!draft) return sessions;
          if (draft.revision !== revision) {
            if (draft.entry.value !== original.value || Boolean(draft.entry.wholeDocument) !== Boolean(original.wholeDocument)) return sessions;
            return { ...sessions, [contextKey]: { ...current, drafts: { ...current.drafts, [key]: { ...draft, entry: { ...draft.entry, value } } } } };
          }
          const drafts = { ...current.drafts }; delete drafts[key];
          return { ...sessions, [contextKey]: { activeKey: current.activeKey === key ? null : current.activeKey, drafts } };
        });
      } catch (e) {
        pushToast({
          kind: 'error',
          message: t('memory.toast.updateFail', { msg: errorMessage(e) }),
        });
      } finally { addPending.current = false; }
    },
    [addMut, context, contextKey, editDraft, pushToast, setEditSessions, t],
  );

  const addNew = useCallback(async () => {
    if (addPending.current || !context || !contextKey) return;
    const trimmedKey = form.key.trim();
    if (!trimmedKey) {
      pushToast({ kind: 'warn', message: t('memory.toast.keyRequired') });
      return;
    }
    const revision = form.revision;
    addPending.current = true;
    try {
      await addMut.mutateAsync({
        scope: form.scope,
        key: trimmedKey,
        value: form.value.trim(),
        createOnly: true,
        expectedContext: context,
      });
      pushToast({ kind: 'success', message: t('memory.toast.added', { key: trimmedKey }) });
      setFormDrafts((drafts) => {
        if (drafts[contextKey]?.revision !== revision) return drafts;
        const next = { ...drafts }; delete next[contextKey]; return next;
      });
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('memory.toast.addFail', { msg: errorMessage(e) }),
      });
    } finally { addPending.current = false; }
  }, [addMut, context, contextKey, form, pushToast, setFormDrafts, t]);

  return {
    context,
    entries,
    filtered,
    counts,
    loading: (!context && !activeQ.error && !workspaceQ.error) || memQ.isLoading,
    error: workspaceQ.error ?? activeQ.error ?? memQ.error,
    refetch: memQ.refetch,

    filter,
    setFilter,

    editingEntry: editDraft?.entry ?? null,
    savedDrafts: Object.values(editSession?.drafts ?? {}),
    editingKey: editDraft ? entryKey(editDraft.entry) : null,
    editValue: editDraft?.value ?? '',
    beginEdit,
    setEditValue,
    cancelEdit,
    discardEdit,

    showForm: form.show,
    toggleShowForm,
    newScope: form.scope,
    setNewScope,
    newKey: form.key,
    setNewKey,
    newValue: form.value,
    setNewValue,

    remove,
    saveEdit,
    addNew,

    isMutating: addMut.isPending || removeMut.isPending,
  };
}

export function entryKey(entry: ReflectMemoryEntry): string {
  return `${entry.scope}:${entry.key}`;
}
