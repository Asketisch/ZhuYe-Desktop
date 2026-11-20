import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zhuye_delete_subagent_spec, zhuye_get_subagent_spec, zhuye_list_subagent_specs, zhuye_save_subagent_spec } from '@/utils/commands/subagents';
export function useSubagentSpecs() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ role: string; markdown: string } | null>(null);
  const specsQuery = useQuery({ queryKey: ['subagent-specs'], queryFn: () => zhuye_list_subagent_specs(), staleTime: 15_000 });
  const saveMutation = useMutation({ mutationFn: (value: { role: string; markdown: string }) => zhuye_save_subagent_spec(value.role, value.markdown), onSuccess: () => void qc.invalidateQueries({ queryKey: ['subagent-specs'] }) });
  const deleteMutation = useMutation({ mutationFn: (role: string) => zhuye_delete_subagent_spec(role), onSuccess: () => void qc.invalidateQueries({ queryKey: ['subagent-specs'] }) });
  const openEditor = async (role: string) => {
    try { const markdown = await zhuye_get_subagent_spec(role); setEditing({ role, markdown: markdown ?? `---\nname: ${role}\nrole: ${role}\n---\n` }); } catch { /* 读取失败保持关闭 */ }
  };
  const save = async () => { if (!editing) return; try { await saveMutation.mutateAsync(editing); setEditing(null); } catch { /* 错误由 mutation 暴露 */ } };
  return { specs: specsQuery.data ?? [], loading: specsQuery.isLoading, editing, setEditing, savePending: saveMutation.isPending, saveError: saveMutation.error instanceof Error ? saveMutation.error.message : null, openEditor, deleteSpec: deleteMutation.mutateAsync, save };
}
export type SubagentSpecsController = ReturnType<typeof useSubagentSpecs>;
