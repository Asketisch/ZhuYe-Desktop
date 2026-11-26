/**
 * 更新检查器与自更新（OTA）封装。
 *
 * - 检查：探测上游 releases(默认 GitHub latest release,可用 env
 *   `ZHUYE_UPDATE_URL` 覆盖)。探测失败**不阻断 UI** —— 后端返回
 *   `error` 字段,前端如实展示。
 * - 安装：走 tauri-plugin-updater 的完整回路(下载 + minisign 校验 +
 *   安装),进度经 `zhuye_update_progress` 事件推送;重启用 tauri 核心
 *   request_restart。均为 Rust 侧插件驱动,前端只经本文件命令面调用。
 *
 * DTO 为 camelCase(桌面端出线约定)。
 */
import { invoke, listen } from '../../bridge';

export interface ZhuyeUpdateInfo {
  /** 当前应用版本。 */
  currentVersion: string;
  /** 最新发布版本;探测失败时为 `null`。 */
  latestVersion: string | null;
  /** 是否存在比当前版本更新的发布。 */
  updateAvailable: boolean;
  /** 发布页 URL(有更新时可打开)。 */
  releaseUrl: string | null;
  /** 发布说明正文。 */
  releaseNotes: string | null;
  /** 探测时间(epoch 秒)。 */
  probedAt: number;
  /** 探测错误(离线 / 非 200)。 */
  error: string | null;
}

/** 自更新安装结果（后端 `UpdateInstallOutcome`,camelCase 出线）。 */
export interface ZhuyeUpdateInstallOutcome {
  /** 是否找到并安装了更新（false = 已是最新,无需重启）。 */
  installed: boolean;
  /** 安装的目标版本（installed=false 时为 `null`）。 */
  version: string | null;
  /** 更新说明正文。 */
  notes: string | null;
}

/**
 * `zhuye_update_progress` 事件负载(后端 `UpdateProgressPayload`,
 * serde tag = "type"、变体名 camelCase)。
 */
export type ZhuyeUpdateProgress =
  | { type: 'started' }
  | { type: 'progress'; downloaded: number; total: number | null }
  | { type: 'finished' };

/**
 * 向上游 releases 探测更新。探测完全失败时返回 `null`。
 */
export async function zhuye_check_update(): Promise<ZhuyeUpdateInfo | null> {
  return invoke<ZhuyeUpdateInfo | null>('zhuye_check_update');
}

/**
 * 检查 → 下载 → 安装更新（一条命令走完整回路,签名校验强制）。
 * 安装完成后需 `zhuye_relaunch_app` 重启生效;进度走
 * `zhuye_update_progress` 事件（见 `listen_update_progress`）。
 */
export async function zhuye_download_install_update(): Promise<ZhuyeUpdateInstallOutcome> {
  return invoke<ZhuyeUpdateInstallOutcome>('zhuye_download_install_update');
}

/**
 * 重启应用（更新安装完成后生效）。后端非阻塞触发,进程由事件循环替换。
 */
export async function zhuye_relaunch_app(): Promise<void> {
  return invoke<void>('zhuye_relaunch_app');
}

/** 订阅更新下载进度事件;返回取消订阅函数。 */
export function listen_update_progress(
  handler: (payload: ZhuyeUpdateProgress) => void,
): Promise<() => void> {
  return listen<ZhuyeUpdateProgress>('zhuye_update_progress', (e) => handler(e.payload));
}
