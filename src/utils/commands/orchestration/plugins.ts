/**
 * 插件 IPC 封装 —— composer 斜杠菜单的插件命令数据源 + **插件管理**。
 *
 * 斜杠菜单部分:只读快照 —— 后端从挂载好的插件运行时取 slash 命令注册表
 * (state/plugins.rs);未挂载 / 无 enabled 插件时返回空数组。选中命令后
 * 由 Composer 以 `/name args` 形态提交,展开仍由后端 submit 边界统一做
 * (expand_submission)。
 *
 * 管理部分:装了什么 / 启用哪些 / marketplace 有哪些 —— 此前 GUI 完全
 * 缺失,只能手改 `~/.zhuye/config.toml` 的 `[plugins] enabled_plugins`
 * 与 `installed_plugins.json`。
 */
import { invoke } from '../../bridge';

export interface ZhuyePluginCommandInfo {
  /** 命令全名(`plugin:ns:name` 形式,如 `demo:hello`),前端拼 `/<name>`。 */
  name: string;
  /** 命令说明(md frontmatter `description`,可缺省)。 */
  description: string | null;
}

/** 列出当前已挂载插件的全部 slash 命令。 */
export async function zhuye_list_plugin_commands(): Promise<ZhuyePluginCommandInfo[]> {
  return invoke<ZhuyePluginCommandInfo[]>('zhuye_list_plugin_commands');
}

// ====== 插件管理 ======

/** 插件安装 scope(与核心 `PluginScope` 的 serde 一致:小写)。 */
export type ZhuyePluginScope = 'managed' | 'user' | 'project' | 'local';

/** 一个已安装插件。 */
export interface ZhuyePluginInfo {
  /** 插件 id。 */
  id: string;
  /** 版本号。 */
  version: string;
  /** 安装 scope。 */
  scope: ZhuyePluginScope;
  /** 安装路径(绝对路径)。 */
  installPath: string;
  /** 安装时间(RFC3339)。 */
  installedAt: string;
  /** 是否已启用(在 `[plugins] enabled_plugins` 里)。 */
  enabled: boolean;
  /** 当前会话加载成功的运行时状态，未加载时为 null。 */
  runtime?: {
    plugin: string;
    scope: string;
    version: string;
    skill_count: number;
    command_count: number;
  } | null;
  /** git 安装的 commit sha(本地目录安装时为 null)。 */
  gitCommitSha?: string | null;
}

/** 一个已知 marketplace。 */
export interface ZhuyeMarketplaceInfo {
  name: string;
  /** 源类型:`directory` / `file` / `github` / `url`。 */
  source: string;
  /** 安装位置(本地路径 / URL / repo)。 */
  installLocation: string;
  /** 启动时是否后台刷新。 */
  autoUpdate: boolean;
}

/** 列出已安装插件 + 是否启用。 */
export function zhuye_list_plugins(): Promise<ZhuyePluginInfo[]> {
  return invoke<ZhuyePluginInfo[]>('zhuye_list_plugins');
}

/** 列出已知 marketplace(config 的 `[plugins].marketplaces`)。 */
export function zhuye_list_marketplaces(): Promise<ZhuyeMarketplaceInfo[]> {
  return invoke<ZhuyeMarketplaceInfo[]>('zhuye_list_marketplaces');
}

/** 启用 / 停用一个插件(落盘 config + 运行时挂/卸 diff 同步)。 */
export function zhuye_toggle_plugin(id: string, enabled: boolean): Promise<void> {
  return invoke('zhuye_toggle_plugin', { id, enabled });
}

/** 卸载一个插件(按 scope 精确卸载)。 */
export function zhuye_uninstall_plugin(
  id: string,
  scope: ZhuyePluginScope,
): Promise<void> {
  return invoke('zhuye_uninstall_plugin', { id, scope });
}

/** 从本地目录安装一个插件(目录里需有 `plugin.toml` 或 `.claude-plugin/plugin.json`)。 */
export function zhuye_install_plugin(
  path: string,
  marketplace: string,
  scope: ZhuyePluginScope,
): Promise<void> {
  return invoke('zhuye_install_plugin', { path, marketplace, scope });
}

// ── v1.11 桌面#2:插件市场(浏览 + 一键安装) ─────────────────────────

/** 市场内一个可安装插件的展示信息。 */
export interface ZhuyeMarketplacePluginInfo {
  name: string;
  description: string;
  version?: string | null;
  category?: string | null;
  tags: string[];
  /** 分发源(JSON 字符串形态)。 */
  source: string;
}

/**
 * 浏览一个 marketplace 的可安装插件清单(读该市场的缓存 manifest)。
 * 市场未注册 / 缓存未物化时 reject(提示先 marketplace add / refresh)。
 */
export function zhuye_browse_marketplace(
  name: string,
): Promise<ZhuyeMarketplacePluginInfo[]> {
  return invoke<ZhuyeMarketplacePluginInfo[]>('zhuye_browse_marketplace', { name });
}

/** 从 marketplace 一键安装插件(含依赖解析;装完挂载进运行时)。 */
export function zhuye_install_from_marketplace(
  marketplace: string,
  plugin: string,
): Promise<void> {
  return invoke('zhuye_install_from_marketplace', { marketplace, plugin });
}
