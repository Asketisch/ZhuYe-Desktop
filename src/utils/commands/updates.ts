/**
 * 更新检查器封装。
 *
 * 探测上游 releases(默认 GitHub latest release,可用 env
 * `REFLECT_UPDATE_URL` 覆盖)。探测失败**不阻断 UI** —— 后端返回
 * `error` 字段,前端如实展示。
 *
 * DTO 为 camelCase(桌面端出线约定)。
 */
import { invoke } from '../bridge';

export interface ReflectUpdateInfo {
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

/**
 * 向上游 releases 探测更新。探测完全失败时返回 `null`。
 */
export async function reflect_check_update(): Promise<ReflectUpdateInfo | null> {
  return invoke<ReflectUpdateInfo | null>('reflect_check_update');
}
