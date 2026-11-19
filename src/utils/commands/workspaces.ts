/**
 * Workspace I/O —— 列出 / 设置 / 查询当前 workspace / 目录选择 / 文件管理器定位。
 */
import { invoke } from '../bridge';

export interface ReflectWorkspaceInfo {
  path: string;
  label: string;
  last_used: number;
  session_count: number;
  hidden?: boolean;
}

export async function reflect_remove_workspace(path: string): Promise<void> {
  await invoke<void>('reflect_remove_workspace', { path });
}

/** 列出已知 workspace。 */
export async function reflect_list_workspaces(): Promise<ReflectWorkspaceInfo[]> {
  return invoke<ReflectWorkspaceInfo[]>('reflect_list_workspaces');
}

/** 按请求顺序切换工作区；一次失败不阻塞后续切换。 */
let workspaceQueue: Promise<void> = Promise.resolve();

/**
 * 切换工作区。`unhide = true` 显式恢复已移除的工作区（管理页「恢复」）；
 * 缺省保留既有 hidden 状态 —— 点击已移除项目的旧会话只跟随 cwd，
 * 不再把项目组复活到侧边栏。
 */
export function reflect_set_workspace(path: string, unhide?: boolean): Promise<void> {
  const result = workspaceQueue.then(() =>
    invoke<void>('reflect_set_workspace', { path, unhide: unhide ?? null }),
  );
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

// ── v1.11 桌面#5:多目录综合工作区 ─────────────────────────────────────

/** 多目录综合工作区状态。 */
export interface ReflectWorkspaceDirsInfo {
  /** 主工作区(规范根:memory / skills / rollout 相对它)。 */
  main: string;
  /** 附加目录(沙箱边界放行,与主工作区合成一个项目)。 */
  additional: string[];
}

/** 设置多目录综合工作区(主 + 附加全量覆盖;附加可为空数组 = 单目录)。 */
export async function reflect_set_workspace_dirs(
  main: string,
  additional: string[],
): Promise<void> {
  await invoke<void>('reflect_set_workspace_dirs', { main, additional });
}

/** 读取当前多目录综合工作区状态。 */
export async function reflect_current_workspace_dirs(): Promise<ReflectWorkspaceDirsInfo> {
  return invoke<ReflectWorkspaceDirsInfo>('reflect_current_workspace_dirs');
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

/**
 * 弹出原生**多选**文件选择框（Composer 附件按钮入口）；取消 → `null`。
 * 返回真实绝对路径：图片扩展名走内联 base64，其余转 file mention
 * （与 Finder 原生拖拽同款管线，见 useComposerDragDrop）。
 */
export async function reflect_pick_files(): Promise<string[] | null> {
  return invoke<string[] | null>('reflect_pick_files');
}

/** 在系统文件管理器（Finder / 资源管理器 / xdg-open）中定位路径。 */
export async function reflect_reveal_path(path: string): Promise<void> {
  return invoke<void>('reflect_reveal_path', { path });
}
