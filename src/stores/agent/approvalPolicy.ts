import type { ApprovalPolicy } from '@/types/protocol';

export type UserApprovalPolicy = Extract<ApprovalPolicy, 'prompt' | 'auto_approve' | 'full_access'>;
const KEY = 'reflect.approvalPolicy.';
const memory = new Map<string, UserApprovalPolicy>();

export function readApprovalPolicy(sessionId: string | null | undefined): UserApprovalPolicy {
  try {
    const key = sessionId ?? 'new';
    const value = localStorage.getItem(KEY + key);
    return value === 'auto_approve' || value === 'full_access' ? value : 'prompt';
  } catch { return memory.get(sessionId ?? 'new') ?? 'prompt'; }
}

export function writeApprovalPolicy(sessionId: string | null | undefined, value: UserApprovalPolicy): void {
  const key = sessionId ?? 'new';
  memory.set(key, value);
  try { localStorage.setItem(KEY + key, value); } catch { /* storage unavailable */ }
}

/** 用户偏好 → wire 值(submission 的 thread_settings.approval_policy)。
 *
 * 核心协议(submodule ≥ 7196d3c5,含审批策略分离)已支持全部三档,
 * 按用户偏好原样发送;未知值仍回落 `prompt`(从紧,绝不静默放宽)。 */
export function wireApprovalPolicy(sessionId: string | null | undefined): UserApprovalPolicy {
  return readApprovalPolicy(sessionId);
}
