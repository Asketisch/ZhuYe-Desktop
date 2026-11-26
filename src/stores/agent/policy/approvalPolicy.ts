import type { ApprovalPolicy } from '@/types/protocol';

export type UserApprovalPolicy = Extract<ApprovalPolicy, 'auto' | 'prompt' | 'auto_approve' | 'full_access'>;
const KEY = 'zhuye.approvalPolicy.';
const memory = new Map<string, UserApprovalPolicy>();

export function readApprovalPolicy(sessionId: string | null | undefined): UserApprovalPolicy {
  // 默认/非法值回落「跟随模式」(auto):由会话工作模式决定审批行为
  // (默认档自动批准文件编辑等),与三段工作模式配套。
  try {
    const key = sessionId ?? 'new';
    const value = localStorage.getItem(KEY + key);
    return isUserApprovalPolicy(value) ? value : 'auto';
  } catch { return memory.get(sessionId ?? 'new') ?? 'auto'; }
}

function isUserApprovalPolicy(value: unknown): value is UserApprovalPolicy {
  return value === 'auto' || value === 'auto_approve' || value === 'full_access' || value === 'prompt';
}

export function writeApprovalPolicy(sessionId: string | null | undefined, value: UserApprovalPolicy): void {
  const key = sessionId ?? 'new';
  memory.set(key, value);
  try { localStorage.setItem(KEY + key, value); } catch { /* storage unavailable */ }
}

/** 会话 id 落定后把预创建键(`'new'`)的偏好转正到正式会话键。
 *  首页 composer 写的是 `'new'` 键;不经转正,首条提交读正式键会拿不到
 *  用户在首页选的值(偏好丢失)。与 promptSelection.movePromptSelection
 *  同款时机:ensureSessionReady 创建成功后调用。仅对**写过的键**生效。 */
export function moveApprovalPolicy(from: string, to: string): void {
  if (rawApprovalPolicy(from) === null) return; // 未写过,无事可转
  writeApprovalPolicy(to, readApprovalPolicy(from));
  memory.delete(from);
  try { localStorage.removeItem(KEY + from); } catch { /* storage unavailable */ }
}

/** 直读原始键(区分「未写过」与「读到默认值回落」—— 转正只对写过的键生效)。 */
function rawApprovalPolicy(key: string): string | null {
  try { return localStorage.getItem(KEY + key); } catch { return memory.has(key) ? 'in-memory' : null; }
}

/** 用户偏好 → wire 值(submission 的 thread_settings.approval_policy)。
 *
 * 默认「跟随模式」(auto):核心在该值下沿用会话工作模式的三段语义
 * (默认档自动批准文件编辑等);其余档按偏好原样发送。 */
export function wireApprovalPolicy(sessionId: string | null | undefined): UserApprovalPolicy {
  return readApprovalPolicy(sessionId);
}
