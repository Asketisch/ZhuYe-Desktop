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
 * 当前核心协议的 ApprovalPolicy 仅接受 `prompt`(auto_approve /
 * full_access 变体在尚未推送的上游提交里,见 docs/CAPABILITIES.md
 * 「最近审计」注记)。未知 wire 值会被核心整体拒收 —— 连消息都发不出去
 * —— 故无论用户偏好为何,这里一律按 `prompt` 发送:**从紧降级**,
 * 宁可多弹审批,绝不静默放宽。上游补齐变体后在此按偏好分发。 */
export function wireApprovalPolicy(_sessionId: string | null | undefined): 'prompt' {
  return 'prompt';
}
