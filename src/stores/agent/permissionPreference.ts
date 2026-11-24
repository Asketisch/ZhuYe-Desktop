/**
 * 会话级工作模式偏好 —— per-session localStorage（仿 approvalPolicy.ts）。
 *
 * 为什么需要：首页 / 未绑定会话时选「计划」，`Op::SetPermissionMode`
 * 只落在占位线程上；首条消息创建真会话后新线程模式回落默认 Auto，
 * 模型仍会调 `EnterPlanMode`，用户又看到「进入计划模式？」确认框。
 *
 * 这里把用户显式选择的工作模式记在本会话键下（首页写 `'new'` 预创建
 * 键，会话 id 落定后由 `movePermissionPreference` 转正），bind →
 * replay 为空的新会话据此校准模式；有落盘记录的老会话尊重 rollout 里
 * 已持久化的模式，不被覆盖。
 */
import type { UiPermissionMode } from '@/types/protocol';
import { useAgentStore } from './store';

const KEY = 'zhuye.permissionMode.';
const memory = new Map<string, UiPermissionMode>();

function isUiPermissionMode(value: unknown): value is UiPermissionMode {
  return value === 'auto' || value === 'prompt' || value === 'plan';
}

/** 无记录返回 null = 用户没有显式选过（沿用会话默认模式）。 */
export function readPermissionPreference(
  sessionId: string | null | undefined,
): UiPermissionMode | null {
  const key = sessionId ?? 'new';
  try {
    const value = localStorage.getItem(KEY + key);
    return isUiPermissionMode(value) ? value : null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePermissionPreference(
  sessionId: string | null | undefined,
  mode: UiPermissionMode,
): void {
  const key = sessionId ?? 'new';
  memory.set(key, mode);
  try {
    localStorage.setItem(KEY + key, mode);
  } catch {
    /* storage unavailable：内存态兜底 */
  }
}

/** 直读原始键（区分「未写过」与「读到默认值」—— 转正只对写过的键生效）。 */
function rawPreference(key: string): string | null {
  try {
    return localStorage.getItem(KEY + key);
  } catch {
    return memory.has(key) ? 'in-memory' : null;
  }
}

/** 会话 id 落定后把预创建键（`'new'`）的偏好转正到正式会话键。 */
export function movePermissionPreference(from: string, to: string): void {
  if (rawPreference(from) === null) return; // 未写过，无事可转
  const value = readPermissionPreference(from);
  if (value) writePermissionPreference(to, value);
  memory.delete(from);
  try {
    localStorage.removeItem(KEY + from);
  } catch {
    /* storage unavailable */
  }
}

/**
 * bind → replay 后为新会话应用用户显式选择的工作模式。
 *
 * `hasRecords = true`（老会话 / 已水合）直接跳过：模式以 rollout 里
 * 最后一条 `PermissionModeChanged` 为准，不覆盖用户中途切过的意图。
 * fire-and-forget，失败不打扰（下次 bind 会再校准）。
 */
export function syncPreferredPermissionMode(
  sessionId: string | null | undefined,
  hasRecords: boolean,
): void {
  if (hasRecords) return;
  const preferred = readPermissionPreference(sessionId);
  if (!preferred) return;
  const state = useAgentStore.getState();
  if (state.permissionMode === preferred) return;
  state.setPermissionMode(preferred).catch(() => {
    /* 线程未就绪等失败：下次 bind 再校准 */
  });
}
