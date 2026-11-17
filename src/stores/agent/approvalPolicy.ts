import type { ApprovalPolicy } from '@/types/protocol';

export type UserApprovalPolicy = Extract<ApprovalPolicy, 'auto' | 'prompt' | 'auto_approve' | 'full_access'>;
const KEY = 'reflect.approvalPolicy.';
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

/** 用户偏好 → wire 值(submission 的 thread_settings.approval_policy)。
 *
 * 默认「跟随模式」(auto):核心在该值下沿用会话工作模式的三段语义
 * (默认档自动批准文件编辑等);其余档按偏好原样发送。 */
export function wireApprovalPolicy(sessionId: string | null | undefined): UserApprovalPolicy {
  return readApprovalPolicy(sessionId);
}
