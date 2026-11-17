import { beforeEach, describe, expect, it } from 'vitest';
import { readApprovalPolicy, writeApprovalPolicy } from './approvalPolicy';

describe('session approval policies', () => {
  beforeEach(() => localStorage.clear());
  it('keeps policies separate for each session', () => {
    writeApprovalPolicy('a', 'full_access');
    writeApprovalPolicy('b', 'auto_approve');
    expect(readApprovalPolicy('a')).toBe('full_access');
    expect(readApprovalPolicy('b')).toBe('auto_approve');
    expect(readApprovalPolicy('c')).toBe('prompt');
  });
});
