/**
 * usePluginCommands —— 插件 slash 命令注册表的同步入口。
 *
 * 从后端拉取已挂载插件的命令列表(`reflect_list_plugin_commands`),
 * 写入 `slashCommands` 的模块级注册表 —— `filterSlashCommands`(弹层
 * 候选 + 键盘导航计数)与 `dispatch`(插件命令直通判定)同源消费。
 *
 * refetchOnMount 'always':插件挂载随会话 rebind 异步完成,Composer
 * 每次挂载(切会话/进聊天页)都重取,列表与运行时保持一致。卸载时清空
 * 注册表,避免残留过期命令。
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reflect_list_plugin_commands } from '@/utils/commands/plugins';
import { setPluginSlashCommands } from './slashCommands';

export const PLUGIN_COMMANDS_QUERY_KEY = ['plugin-commands'] as const;

export function usePluginCommands() {
  const { data } = useQuery({
    queryKey: PLUGIN_COMMANDS_QUERY_KEY,
    queryFn: reflect_list_plugin_commands,
    refetchOnMount: 'always',
    staleTime: 30_000,
  });

  useEffect(() => {
    setPluginSlashCommands(data ?? []);
    return () => setPluginSlashCommands([]);
  }, [data]);
}
