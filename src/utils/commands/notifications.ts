/**
 * Notifications 域 IPC —— dock badge 等系统级通知出口。
 *
 * `zhuye_set_dock_badge`:macOS NSDockTile badge;`null` 清空;
 * 非 macOS 后端为 no-op stub,前端无需平台分支。
 */
import { invoke } from '../bridge';

export async function zhuye_set_dock_badge(label: string | null): Promise<void> {
  return invoke<void>('zhuye_set_dock_badge', { label });
}
