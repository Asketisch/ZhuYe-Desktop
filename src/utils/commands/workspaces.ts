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

/** 按请求顺序切换工作区；一次失败不阻塞后续切换。 */
let workspaceQueue: Promise<void> = Promise.resolve();

export function reflect_set_workspace(path: string): Promise<void> {
  const result = workspaceQueue.then(() => invoke<void>('reflect_set_workspace', { path }));
  workspaceQueue = result.then(() => {}, () => {});
  return result;
}

/** 等待所有已排队的工作区切换，包括等待期间新增的请求。 */
export async function waitForWorkspaceSwitches(): Promise<void> {
  let pending: Promise<void>;
  do {
    pending = workspaceQueue;
    await pending;
  } while (pending !== workspaceQueue);
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
