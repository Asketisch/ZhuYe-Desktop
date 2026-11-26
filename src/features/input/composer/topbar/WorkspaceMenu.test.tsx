/**
 * Vitest —— invalidateWorkspaceQueries 失效集合契约。
 *
 * zhuye_set_workspace 会 upsert workspaces.json（工作区注册表），切换 /
 * 添加工作区后必须失效 `['workspaces']` —— 侧栏的空项目组正来自该查询，
 * 漏失效表现为「添加工作区后侧栏不刷新」（实测 bug）。本测试锁死集合，
 * 防止后续增删键时再把注册表漏掉。
 */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateWorkspaceQueries } from './WorkspaceMenu';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/harness/shell/useCurrentWorkspace';
import { SESSIONS_QUERY_KEY, WORKSPACES_QUERY_KEY } from '@/logic/conversation/sessions/useSessions';

const REQUIRED_KEYS: readonly (readonly unknown[])[] = [
  CURRENT_WORKSPACE_QUERY_KEY,
  WORKSPACES_QUERY_KEY,
  SESSIONS_QUERY_KEY,
  ['git-status'],
  ['git-worktrees'],
];

describe('invalidateWorkspaceQueries', () => {
  it('失效集合含工作区注册表 + 当前工作区 + 会话 + git 上下文,无关键不误伤', () => {
    const qc = new QueryClient();
    // 预置 fresh 缓存,使 invalidate 后 isInvalidated 可观测。
    for (const key of [...REQUIRED_KEYS, ['unrelated']]) {
      qc.setQueryData(key, { seeded: true });
    }

    invalidateWorkspaceQueries(qc);

    for (const key of REQUIRED_KEYS) {
      const state = qc.getQueryCache().find({ queryKey: key })?.state;
      expect(state?.isInvalidated, `键 ${JSON.stringify(key)} 应被失效`).toBe(true);
    }
    const unrelated = qc.getQueryCache().find({ queryKey: ['unrelated'] })?.state;
    expect(unrelated?.isInvalidated).toBe(false);
  });
});
