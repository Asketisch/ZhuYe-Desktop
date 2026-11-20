/**
 * Vitest — useSessions hook 测试。
 *
 * 验证:
 * 1. 挂载后自动调用 zhuye_list_sessions
 * 2. 时间分桶正确 (Now / Today / Yesterday / This week / Older)
 * 3. refresh 重新拉取
 * 4. rename 调用 zhuye_rename_session + refresh
 * 5. 错误处理 (invoke reject)
 * 6. 项目目录分组 (侧边栏 groups: 会话归组 + 已知项目合并 + 未归属哨兵)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSessions, useActiveSession } from '@/features/sessions/hooks/useSessions';
import { UNASSIGNED_GROUP_KEY } from '@/features/sessions/utils/workspaceGroups';
import { mockInvoke, resetMockInvoke, createTestQueryClient } from '@/test/setup.tsx';

// 供 useActiveSession 使用的 router hooks 模块级模拟。
// 可通过 `__mockPathname` 在每个测试中切换路径名。
const __mockPathname: { current: string } = { current: '/chat' };
const __mockNavigate = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return {
    ...actual,
    useNavigate: () => __mockNavigate,
    useLocation: () => ({ pathname: __mockPathname.current }),
  };
});

function hookWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('useSessions', () => {
  beforeEach(() => {
    resetMockInvoke();
    const now = Date.now();
    mockInvoke('zhuye_list_sessions', async () => [
      {
        session_id: 's1',
        model: 'stub/test',
        started_at: new Date(now - 30 * 60 * 1000).toISOString(),
        message_count: 2,
      },
      {
        session_id: 's2',
        model: 'stub/test',
        started_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        message_count: 5,
      },
      {
        session_id: 's3',
        model: 'stub/test',
        started_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        message_count: 1,
      },
    ]);
  });

  it('fetches sessions on mount', async () => {
    let invoked = false;
    mockInvoke('zhuye_list_sessions', async () => {
      invoked = true;
      return [];
    });

    const { result } = renderHook(() => useSessions(), {
      wrapper: hookWrapper,
    });

    await waitFor(() => expect(invoked).toBe(true), { timeout: 2000 });
    expect(result.current.error).toBeNull();
    expect(result.current.buckets).toEqual([]);
  });

  it('buckets sessions by time', async () => {
    const { result } = renderHook(() => useSessions(), {
      wrapper: hookWrapper,
    });

    await waitFor(() => expect(result.current.buckets.length).toBeGreaterThan(0), { timeout: 2000 });

    const labels = result.current.buckets.map((b) => b.label);
    expect(labels).toContain('Now');
    expect(labels).toContain('Today');
    expect(labels).toContain('Older');
  });

  it('calls zhuye_rename_session on rename', async () => {
    let renameInvoked = false;
    mockInvoke('zhuye_rename_session', async () => {
      renameInvoked = true;
    });

    const { result } = renderHook(() => useSessions(), {
      wrapper: hookWrapper,
    });

    await waitFor(() => expect(result.current.buckets.length).toBeGreaterThan(0), { timeout: 2000 });

    await act(async () => {
      await result.current.rename('s1', 'new name');
    });

    expect(renameInvoked).toBe(true);
  });

  it('sets error on invoke failure', async () => {
    mockInvoke('zhuye_list_sessions', async () => {
      throw new Error('network error');
    });

    const { result } = renderHook(() => useSessions(), {
      wrapper: hookWrapper,
    });

    await waitFor(() => expect(!!result.current.error).toBe(true), { timeout: 2000 });
    const err = result.current.error;
    const msg = typeof err === 'string'
      ? err
      : ((err as Error | null)?.message ?? String(err));
    expect(msg).toContain('network error');
  });

  it('refresh re-fetches sessions', async () => {
    let callCount = 0;
    mockInvoke('zhuye_list_sessions', async () => {
      callCount += 1;
      return [];
    });

    const { result } = renderHook(() => useSessions(), {
      wrapper: hookWrapper,
    });

    await waitFor(() => expect(callCount).toBe(1), { timeout: 2000 });

    act(() => result.current.refetch());

    await waitFor(() => expect(callCount).toBe(2), { timeout: 2000 });
  });
});

describe('useSessions workspace 过滤 (v1.x workspace→session 归属)', () => {
  it('omitted workspace lists everything (workspace: null on the wire)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    mockInvoke('zhuye_list_sessions', async (_c, args) => {
      seen.push((args as Record<string, unknown>) ?? {});
      return [];
    });

    renderHook(() => useSessions(), { wrapper: hookWrapper });

    await waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(seen[0]).toEqual({ workspace: null, limit: null, offset: null });
  });

  it('passes workspacePath through and re-fetches on workspace switch', async () => {
    const seen: Array<Record<string, unknown>> = [];
    mockInvoke('zhuye_list_sessions', async (_c, args) => {
      seen.push((args as Record<string, unknown>) ?? {});
      return [];
    });

    const { rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useSessions({ workspacePath: ws }),
      { wrapper: hookWrapper, initialProps: { ws: '/tmp/proj-a' } },
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(seen[0]).toEqual({ workspace: '/tmp/proj-a', limit: null, offset: null });

    // 切换工作区 → queryKey 变化 → 自动重拉(旧缓存不串台)。
    rerender({ ws: '/tmp/proj-b' });
    await waitFor(() => expect(seen.length).toBe(2), { timeout: 2000 });
    expect(seen[1]).toEqual({ workspace: '/tmp/proj-b', limit: null, offset: null });
  });
});

describe('useSessions 项目分组 (sidebar groups)', () => {
  it('computes workspace groups from sessions + known workspaces', async () => {
    const now = Date.now();
    mockInvoke('zhuye_list_sessions', async () => [
      {
        session_id: 's1',
        model: 'stub/test',
        started_at: new Date(now - 60_000).toISOString(),
        message_count: 1,
        workspace: '/tmp/proj-a',
      },
      {
        session_id: 's2',
        model: 'stub/test',
        started_at: new Date(now - 120_000).toISOString(),
        message_count: 1,
      },
    ]);
    mockInvoke('zhuye_list_workspaces', async () => [
      { path: '/tmp/proj-a', label: 'proj-a', last_used: 1, session_count: 1 },
      { path: '/tmp/proj-b', label: 'proj-b', last_used: 2, session_count: 0 },
    ]);

    const { result } = renderHook(() => useSessions(), { wrapper: hookWrapper });
    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0), { timeout: 2000 });

    // 有会话的组在前（按最近活跃），空项目组随后，未归属哨兵分组固定最后。
    expect(result.current.groups.map((g) => g.path)).toEqual(['/tmp/proj-a', '/tmp/proj-b', null]);
    const [projA, , unassigned] = result.current.groups;
    expect(projA.label).toBe('proj-a');
    expect(projA.sessions.map((s) => s.session_id)).toEqual(['s1']);
    expect(unassigned.key).toBe(UNASSIGNED_GROUP_KEY);
    expect(unassigned.sessions.map((s) => s.session_id)).toEqual(['s2']);
  });
});

describe('useActiveSession', () => {
  beforeEach(() => {
    __mockPathname.current = '/chat';
    __mockNavigate.mockClear();
  });

  it('reads null when on /chat', () => {
    __mockPathname.current = '/chat';
    const { result } = renderHook(() => useActiveSession(), { wrapper: hookWrapper });

    expect(result.current.activeId).toBeNull();
  });

  it('reads sessionId from /chat/:id pathname', () => {
    __mockPathname.current = '/chat/s-abc';
    const { result } = renderHook(() => useActiveSession(), { wrapper: hookWrapper });

    expect(result.current.activeId).toBe('s-abc');
  });

  it('exposes clear() that navigates to /chat', async () => {
    __mockPathname.current = '/chat/s-abc';
    const { result } = renderHook(() => useActiveSession(), { wrapper: hookWrapper });

    await act(async () => {
      result.current.clear();
    });
    expect(__mockNavigate).toHaveBeenCalledWith({ to: '/chat' });
  });
});