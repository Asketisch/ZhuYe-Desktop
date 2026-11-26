import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { parseMcpArguments } from '@/logic/orchestration/collaboration/parseMcpArguments';
import { zhuye_delete_mcp_server, zhuye_list_mcp_prompts, zhuye_list_mcp_resources, zhuye_list_mcp_servers, zhuye_mcp_catalog, zhuye_upsert_mcp_server, type McpServerEntry } from '@/utils/commands/mcp';

export const MCP_TRANSPORTS: McpServerEntry['type'][] = ['stdio', 'http', 'sse'];
export function mcpErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}
export function useMcpManagerController() {
  const qc = useQueryClient();
  const runtime = useAgentStore((state) => state.mcpServers);
  const serversQuery = useQuery({ queryKey: ['mcp-servers'], queryFn: () => zhuye_list_mcp_servers(), staleTime: 10_000 });
  const catalogQuery = useQuery({ queryKey: ['mcp-catalog'], queryFn: () => zhuye_mcp_catalog(), staleTime: 300_000 });
  const [showForm, setShowForm] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showPrimitives, setShowPrimitives] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpServerEntry['type']>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [argsError, setArgsError] = useState(false);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['mcp-servers'] }); };
  const upsertMutation = useMutation({ mutationFn: (value: { name: string; entry: McpServerEntry }) => zhuye_upsert_mcp_server(value.name, value.entry), onSettled: invalidate });
  const deleteMutation = useMutation({ mutationFn: (serverName: string) => zhuye_delete_mcp_server(serverName), onSettled: invalidate });
  const resourcesQuery = useQuery({ queryKey: ['mcp-resources'], queryFn: () => zhuye_list_mcp_resources(), enabled: showPrimitives, staleTime: 30_000 });
  const promptsQuery = useQuery({ queryKey: ['mcp-prompts'], queryFn: () => zhuye_list_mcp_prompts(), enabled: showPrimitives, staleTime: 30_000 });
  const servers = serversQuery.data ?? []; const catalog = catalogQuery.data ?? [];
  const resources = resourcesQuery.data ?? []; const prompts = promptsQuery.data ?? [];
  const busy = upsertMutation.isPending || deleteMutation.isPending;
  const submit = async () => {
    const serverName = name.trim(); if (!serverName) return;
    let args: string[] | null = null;
    if (transport === 'stdio') { try { args = parseMcpArguments(argsText); } catch { setArgsError(true); return; } }
    setArgsError(false);
    try {
      await upsertMutation.mutateAsync({ name: serverName, entry: { type: transport, command: transport === 'stdio' ? command.trim() : null, args, url: transport === 'stdio' ? null : url.trim() } });
      setName(''); setCommand(''); setArgsText(''); setUrl(''); setShowForm(false);
    } catch { /* mutation 状态负责展示 */ }
  };
  const addFromCatalog = async (entryId: string) => {
    const entry = catalog.find((item) => item.id === entryId); if (!entry) return;
    try { await upsertMutation.mutateAsync({ name: entry.id, entry: { type: 'stdio', command: entry.command, args: entry.args } }); } catch { /* 同上 */ }
  };
  return { runtime, serversQuery, catalogQuery, resourcesQuery, promptsQuery, showForm, setShowForm,
    showCatalog, setShowCatalog, showPrimitives, setShowPrimitives, name, setName, transport, setTransport,
    command, setCommand, argsText, setArgsText, url, setUrl, argsError, setArgsError,
    upsertMutation, deleteMutation, resources, prompts, servers, catalog, busy, submit, addFromCatalog };
}
export type McpManagerController = ReturnType<typeof useMcpManagerController>;
