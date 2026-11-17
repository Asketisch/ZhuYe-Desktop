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
