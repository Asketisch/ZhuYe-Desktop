/**
 * Workspace I/O —— 列出 / 设置 / 查询当前 workspace / 目录选择 / 文件管理器定位。
 */
import { invoke } from '../bridge';

export interface ReflectWorkspaceInfo {
  path: string;
  label: string;
  last_used: number;
  session_count: number;
}

/** 列出已知 workspace。 */
export async function reflect_list_workspaces(): Promise<ReflectWorkspaceInfo[]> {
  return invoke<ReflectWorkspaceInfo[]>('reflect_list_workspaces');
}

/** 按绝对路径设置当前 workspace。 */
export async function reflect_set_workspace(path: string): Promise<void> {
  return invoke<void>('reflect_set_workspace', { path });
}

/** 返回当前 workspace 的绝对路径。 */
export async function reflect_current_workspace(): Promise<string> {
  return invoke<string>('reflect_current_workspace');
}

/** 弹出原生目录选择框；用户取消时返回 `null`。 */
export async function reflect_pick_workspace_folder(): Promise<string | null> {
  return invoke<string | null>('reflect_pick_workspace_folder');
}

/**
 * 弹出原生文件选择框（discussion / pipeline 的 TOML 配置入口）；
 * 用户取消时返回 `null`。`extensions` 为扩展名白名单（不含点，如 `['toml']`）。
 */
export async function reflect_pick_file(extensions?: string[]): Promise<string | null> {
  return invoke<string | null>('reflect_pick_file', { extensions: extensions ?? null });
}

/** 在系统文件管理器（Finder / 资源管理器 / xdg-open）中定位路径。 */
export async function reflect_reveal_path(path: string): Promise<void> {
  return invoke<void>('reflect_reveal_path', { path });
}
