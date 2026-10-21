/**
 * MCP 服务管理 IPC 包装。
 *
 * 对应 `src-tauri/src/commands/mcp.rs`:
 * - 列出配置中的 MCP server + 运行状态;
 * - 浏览内置精选 catalog(离线清单 + 安装提示);
 * - 增删 server:落盘 `config.toml` 的 `[mcp_servers.<name>]` + 运行时
 *   起/停(注册/反注册其工具)。
 */
import { invoke } from '../bridge';

/** 一个已配置的 MCP server。 */
export interface McpServerInfo {
  /** server 名(`[mcp_servers.<name>]` 的键)。 */
  name: string;
  /** transport:`stdio` / `http` / `sse`。 */
  transport: string;
  /** stdio 启动命令。 */
  command?: string | null;
  /** stdio 启动参数。 */
  args: string[];
  /** http / sse 地址。 */
  url?: string | null;
  /** 当前是否在运行。 */
  running: boolean;
}

/** 精选 catalog 条目。 */
export interface McpCatalogEntry {
  /** 稳定 id(写配置时用的键)。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 一句话说明。 */
  description: string;
  /** 分类。 */
  category: string;
  /** stdio 启动命令。 */
  command: string;
  /** stdio 启动参数。 */
  args: string[];
  /** 安装提示(核心给的,含 npm 包名等)。 */
  installHint: string;
}

/**
 * MCP server 的配置条目(对应 `reflect_config::McpServerEntry`)。
 *
 * 注意 `transport` 的线上字段名是 **`type`**(配置里写 `type = "stdio"`)。
 */
export interface McpServerEntry {
  type: 'stdio' | 'http' | 'sse';
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  timeout_ms?: number | null;
  always_load?: boolean | null;
}

/** 列出配置中的全部 MCP server + 运行状态。 */
export function reflect_list_mcp_servers(): Promise<McpServerInfo[]> {
  return invoke('reflect_list_mcp_servers');
}

/** 列出内置精选 MCP catalog(离线清单 + 安装提示)。 */
export function reflect_mcp_catalog(): Promise<McpCatalogEntry[]> {
  return invoke('reflect_mcp_catalog');
}

/** 新增或更新一个 MCP server(落盘 + 运行时起停)。 */
export function reflect_upsert_mcp_server(
  name: string,
  entry: McpServerEntry,
): Promise<void> {
  return invoke('reflect_upsert_mcp_server', { name, entry });
}

/** 删除一个 MCP server(落盘 + 运行时停服)。 */
export function reflect_delete_mcp_server(name: string): Promise<void> {
  return invoke('reflect_delete_mcp_server', { name });
}

/** 一个 MCP 资源。 */
export interface McpResourceInfo {
  /** 暴露该资源的 server 名。 */
  server: string;
  name: string;
  /** 资源 URI。 */
  uri: string;
  description?: string | null;
  mimeType?: string | null;
}

/** 一个 MCP prompt 模板。 */
export interface McpPromptInfo {
  /** 暴露该 prompt 的 server 名。 */
  server: string;
  name: string;
  description?: string | null;
  /** 参数名列表。 */
  arguments: string[];
}

/**
 * 列出所有 MCP server 暴露的资源。
 *
 * MCP 三大原语里此前只有 tools 对用户可达 —— resources / prompts 只能被
 * LLM 调用,用户想复用某个 server 的资源或 prompt 模板时没有路径。
 */
export function reflect_list_mcp_resources(): Promise<McpResourceInfo[]> {
  return invoke('reflect_list_mcp_resources');
}

/** 列出所有 MCP server 暴露的 prompt 模板。 */
export function reflect_list_mcp_prompts(): Promise<McpPromptInfo[]> {
  return invoke('reflect_list_mcp_prompts');
}
