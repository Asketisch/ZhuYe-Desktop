/**
 * 会话级思考强度偏好 —— per-session localStorage（仿
 * permissionPreference / approvalPolicy 同款）。
 *
 * 为什么需要：composer 选档走 `Op::SetEffort`，只写**当前会话线程的
 * 内存槽位**，不落配置；而每次线程重建（切换会话、保存设置 / 配置热
 * 重载、模型切换、应用重启）都会以 `[model].reasoning_effort` 的配置
 * 默认值重新播种档位 —— 用户选的 max 静默变回 medium。
 *
 * 这里把用户在 composer 的显式选择记在本会话键下（首页写 `'new'`
 * 预创建键，会话 id 落定后 `moveEffortPreference` 转正）；bind 后
 * [`syncEffortPreference`] 对比线程槽位，不一致时重放 `zhuye_set_effort`
 * —— 偏好无损恢复，模型不支持时由能力表在发 wire 前钳制降级
 * （槽位仍存原始档，切回支持该档的模型自动生效）。
 *
 * 注意与 `promptSelection` 不同：effort 没有引擎共享锁的顾虑，同会话
 * 内随时可改（`Op::SetEffort` 本就是运行时档位），因此不做「仅新会话
 * 应用」的限制 —— 每次 bind / 热重载后都校准到用户偏好。
 */
import { zhuye_get_effort, zhuye_set_effort } from '@/utils/commands';

const KEY = 'zhuye.effortPreference.';
const memory = new Map<string, string>();

/** 合法档位（与 composer EffortPicker 的 ALL_EFFORTS 同口径）。 */
const LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

/** 无记录返回 null = 用户没在 composer 显式选过（配置默认值生效）。 */
export function readEffortPreference(sessionId: string | null | undefined): string | null {
  const key = sessionId ?? 'new';
  try {
    const value = localStorage.getItem(KEY + key);
    return value && LEVELS.has(value) ? value : null;
  } catch {
    const value = memory.get(key);
    return value && LEVELS.has(value) ? value : null;
  }
}

export function writeEffortPreference(
  sessionId: string | null | undefined,
  level: string,
): void {
  if (!LEVELS.has(level)) return;
  const key = sessionId ?? 'new';
  memory.set(key, level);
  try {
    localStorage.setItem(KEY + key, level);
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
export function moveEffortPreference(from: string, to: string): void {
  if (rawPreference(from) === null) return; // 未写过，无事可转
  const value = readEffortPreference(from);
  if (value) writeEffortPreference(to, value);
  memory.delete(from);
  try {
    localStorage.removeItem(KEY + from);
  } catch {
    /* storage unavailable */
  }
}

/**
 * bind / 热重载后把用户偏好校准回线程槽位。
 *
 * 读线程槽位（`zhuye_get_effort`）与偏好对比，一致则跳过（不写冗余
 * op）；不一致重放 `zhuye_set_effort` —— fire-and-forget：线程刚被
 * 替换的瞬时竞态会让 op 快速失败，偏好保留，下次 bind 再校准。
 */
export async function syncEffortPreference(
  sessionId: string | null | undefined,
): Promise<void> {
  const saved = readEffortPreference(sessionId);
  if (!saved) return;
  try {
    const current = await zhuye_get_effort();
    if (current === saved) return;
    await zhuye_set_effort(saved);
  } catch {
    /* 线程未就绪 / 会话切换竞态：偏好保留，下次 bind 再校准 */
  }
}
