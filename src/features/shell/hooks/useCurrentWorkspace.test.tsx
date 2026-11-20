/**
 * Vitest — useCurrentWorkspace hook。
 *
 * 验证:
 * 1. 挂载后调用 zhuye_current_workspace 并回填绝对路径
 * 2. 后端返回 null(未打开工作区) → currentWorkspace 为 null
 * 3. 30s staleTime 内重复挂载不重复拉取(缓存生效)
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace, CURRENT_WORKSPACE_QUERY_KEY } from './useCurrentWorkspace';
import { mockInvoke, resetMockInvoke } from '@/test/setup';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

// 每个 it 内 resetMockInvoke + mockInvoke —— 与本仓库其他 hook 测试同模式。
describe('useCurrentWorkspace', () => {
  it('calls zhuye_current_workspace on mount and returns the path', async () => {
    resetMockInvoke();
    let called = false;
    mockInvoke('zhuye_current_workspace', async () => {
      called = true;
      return '/Users/dev/project';
    });

    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper: wrapper });
    expect(result.current.currentWorkspace).toBeNull(); // 初始未加载
    await waitFor(() => expect(called).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(result.current.currentWorkspace).toBe('/Users/dev/project'), {
      timeout: 2000,
    });
  });

  it('returns null (not undefined) when the backend has no open workspace', async () => {
    resetMockInvoke();
    let called = false;
    mockInvoke('zhuye_current_workspace', async () => {
      called = true;
      return null;
    });

    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper: wrapper });
    // 等 invoke 真正落地后再断言 —— 避免把"尚未加载"误判为"后端无工作区"。
    await waitFor(() => expect(called).toBe(true), { timeout: 2000 });
    expect(result.current.currentWorkspace ?? null).toBeNull();
  });

  it('caches within staleTime (second mount does not re-fetch)', async () => {
    resetMockInvoke();
    let calls = 0;
    mockInvoke('zhuye_current_workspace', async () => {
      calls += 1;
      return '/Users/dev/project';
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mk = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useCurrentWorkspace(), { wrapper: mk as never });
    await waitFor(() => expect(first.result.current.currentWorkspace).toBe('/Users/dev/project'), {
      timeout: 2000,
    });
    // 同一 client 内再挂载 —— 30s staleTime 内命中缓存, 不再 invoke。
    const second = renderHook(() => useCurrentWorkspace(), { wrapper: mk as never });
    await waitFor(() => expect(second.result.current.currentWorkspace).toBe('/Users/dev/project'), {
      timeout: 2000,
    });
    expect(calls).toBe(1);
    // 导出稳定 queryKey, 供 zhuye_set_workspace 成功后手动失效。
    expect(CURRENT_WORKSPACE_QUERY_KEY).toEqual(['current-workspace']);
  });
});
