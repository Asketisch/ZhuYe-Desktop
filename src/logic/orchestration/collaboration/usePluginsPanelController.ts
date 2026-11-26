import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zhuye_install_plugin, zhuye_list_marketplaces, zhuye_list_plugins, zhuye_pick_workspace_folder, zhuye_toggle_plugin, zhuye_uninstall_plugin, type ZhuyePluginScope } from '@/utils/commands';
import { PLUGIN_COMMANDS_QUERY_KEY } from '@/logic/input/composer/usePluginCommands';
import { AGENTS_QUERY_KEY } from '@/logic/orchestration/agents/useAgentsController';
export const PLUGIN_SCOPES: ZhuyePluginScope[] = ['user','project','local','managed'];
export function pluginErrorMessage(error: unknown): string { if (error instanceof Error) return error.message; if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg; return String(error); }
export function usePluginsPanelController() {
  const qc = useQueryClient();
  const [showInstall, setShowInstall] = useState(false); const [path, setPath] = useState(''); const [marketplace, setMarketplace] = useState('local'); const [scope, setScope] = useState<ZhuyePluginScope>('user'); const [actionError, setActionError] = useState<string | null>(null);
  const pluginsQuery = useQuery({ queryKey: ['plugins'], queryFn: () => zhuye_list_plugins(), staleTime: 10_000, refetchInterval: 5_000 });
  const marketsQuery = useQuery({ queryKey: ['plugin-marketplaces'], queryFn: () => zhuye_list_marketplaces(), staleTime: 60_000 });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['plugins'] }); void qc.invalidateQueries({ queryKey: PLUGIN_COMMANDS_QUERY_KEY }); void qc.invalidateQueries({ queryKey: ['skills'] }); void qc.invalidateQueries({ queryKey: ['mcp-servers'] }); void qc.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }); };
  const toggleMutation = useMutation({ mutationFn: (value: { id: string; enabled: boolean }) => zhuye_toggle_plugin(value.id, value.enabled), onMutate: () => setActionError(null), onError: (error) => setActionError(pluginErrorMessage(error)), onSettled: invalidate });
  const uninstallMutation = useMutation({ mutationFn: (value: { id: string; scope: ZhuyePluginScope }) => zhuye_uninstall_plugin(value.id, value.scope), onMutate: () => setActionError(null), onError: (error) => setActionError(pluginErrorMessage(error)), onSettled: invalidate });
  const installMutation = useMutation({ mutationFn: (value: { path: string; marketplace: string; scope: ZhuyePluginScope }) => zhuye_install_plugin(value.path, value.marketplace, value.scope), onSettled: invalidate });
  const plugins = pluginsQuery.data ?? []; const markets = marketsQuery.data ?? []; const loadedPlugins = pluginsQuery.isError ? [] : plugins.flatMap((plugin) => plugin.runtime ? [plugin.runtime] : []);
  const busy = toggleMutation.isPending || uninstallMutation.isPending || installMutation.isPending;
  const browse = async () => { try { const picked = await zhuye_pick_workspace_folder(); if (picked) setPath(picked); } catch { /* 用户取消时保留手填值 */ } };
  return { showInstall, setShowInstall, path, setPath, marketplace, setMarketplace, scope, setScope, actionError,
    pluginsQuery, marketsQuery, toggleMutation, uninstallMutation, installMutation, plugins, markets, loadedPlugins, busy, browse };
}
export type PluginsPanelController = ReturnType<typeof usePluginsPanelController>;
