/**
 * usePaletteActions —— 命令面板动作编排测试。
 *
 * 覆盖:
 *   - newSession 触发 onNewChat + pushToast(info)
 *   - exportActive 无 activeId 时推 warn toast,有 activeId 时调 reflect_export_session
 *   - saveConfig 调 reflect_save_config('') 并推 success toast
 *   - runSlash 调 submit
 *   - clearAllSessions 复用 qc 缓存的 sessions
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePaletteActions, type PaletteToasts } from './usePaletteActions';
import { useAgentStore } from '@/stores/agentStore';
import { mockInvoke, resetMockInvoke } from '@/test/setup';

// clearAllSessions 有二次确认(ConfirmDialog);测试中自动确认。
vi.mock('@/features/modals/ConfirmDialog', () => ({
  confirmDialog: async () => true,
}));

// useEnsureSession(→ useActiveSession)依赖 router hooks;本文件只测
// palette 动作编排,用静态 mock 提供最小上下文(pathname=/chat → activeId=null)。
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/chat' }),
}));

const TOASTS: PaletteToasts = {
  newSession: 'New session started.',
  noSessionsToClear: 'No sessions to clear.',
  clearedSessionsLabel: 'Clear all sessions',
  clearAllConfirm: (count) => `Delete ${count} sessions?`,
  deleteFailed: (msg) => `Delete failed: ${msg}`,
  clearedSessions: (count) => `Cleared ${count} session(s).`,
  noActiveToExport: 'No active session to export.',
  exported: (path) => `Exported → ${path}`,
  exportedNoPath: 'Exported → (no path)',
  exportFailed: (msg) => `Export failed: ${msg}`,
  exportedMarkdown: (path) => `Exported Markdown → ${path}`,
  exportedMarkdownNoPath: 'Exported Markdown → (no path)',
  configReloaded: 'Config reloaded.',
  saveFailed: (msg) => `Save failed: ${msg}`,
};

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePaletteActions', () => {
  let qc: QueryClient;
  let onNewChat: () => void;

  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    onNewChat = vi.fn();
  });
  afterEach(() => {
    resetMockInvoke();
  });

  it('newSession: invokes onNewChat + info toast', () => {
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    act(() => result.current.newSession());
    expect(onNewChat).toHaveBeenCalledTimes(1);
    // toast 已推入 store
    const toasts = useAgentStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[toasts.length - 1].kind).toBe('info');
    expect(toasts[toasts.length - 1].message).toBe('New session started.');
  });

  it('exportActive: no activeId → warn toast', async () => {
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActive();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].kind).toBe('warn');
    expect(toasts[toasts.length - 1].message).toBe('No active session to export.');
  });

  it('exportActive: success path calls reflect_export_session + success toast', async () => {
    const spy = vi.fn(async () => '/tmp/foo.json');
    mockInvoke('reflect_export_session', spy);

    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: 'sess-1',
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActive();
    });
    // 桥接层将 cmd + args 一并转给 handler；验证 id 已传入。
    expect(spy).toHaveBeenCalledWith(
      'reflect_export_session',
      expect.objectContaining({ id: 'sess-1' }),
    );

    const toasts = useAgentStore.getState().toasts;
    const last = toasts[toasts.length - 1];
    expect(last.kind).toBe('success');
    expect(last.message).toBe('Exported → /tmp/foo.json');
  });

  it('exportActive: null path uses exportedNoPath', async () => {
    mockInvoke('reflect_export_session', async () => null);

    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: 'sess-1',
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActive();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].message).toBe('Exported → (no path)');
  });

  // ── markdown 转录导出（核心 `to_markdown`；此前有后端无入口）──

  it('exportActiveMarkdown: calls reflect_export_session_markdown + success toast', async () => {
    const spy = vi.fn(async () => ({ path: '/tmp/foo.md', bytes: 42 }));
    mockInvoke('reflect_export_session_markdown', spy);

    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: 'sess-1',
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActiveMarkdown();
    });
    expect(spy).toHaveBeenCalledWith(
      'reflect_export_session_markdown',
      expect.objectContaining({ id: 'sess-1' }),
    );
    const toasts = useAgentStore.getState().toasts;
    const last = toasts[toasts.length - 1];
    expect(last.kind).toBe('success');
    expect(last.message).toBe('Exported Markdown → /tmp/foo.md');
  });

  it('exportActiveMarkdown: no active session → warn toast', async () => {
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActiveMarkdown();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].kind).toBe('warn');
    expect(toasts[toasts.length - 1].message).toBe('No active session to export.');
  });

  it('exportActiveMarkdown: failure → error toast', async () => {
    mockInvoke('reflect_export_session_markdown', async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: 'sess-1',
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.exportActiveMarkdown();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].kind).toBe('error');
  });

  it('saveConfig: success toast', async () => {    mockInvoke('reflect_save_config', async () => undefined);
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.saveConfig();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].message).toBe('Config reloaded.');
  });

  it('saveConfig: failure toast', async () => {
    mockInvoke('reflect_save_config', async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.saveConfig();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].kind).toBe('error');
    expect(toasts[toasts.length - 1].message).toBe('Save failed: boom');
  });

  it('runSlash: slash 命令走 slashEngine 分发,不把字面文本发给模型', async () => {
    const submitSpy = vi.spyOn(useAgentStore.getState(), 'submit');
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    // /compact 是 submit_with_submission 类:必须触发 reflect_compact,
    // 而不是把 "/compact" 作为普通文本 submit 给模型。
    let compactCalled = false;
    mockInvoke('reflect_compact', async () => {
      compactCalled = true;
      return 'ok';
    });
    act(() => result.current.runSlash('/compact'));
    await waitFor(() => expect(compactCalled).toBe(true));
    expect(submitSpy).not.toHaveBeenCalled();

    // 非 slash 文本回退到普通提交。
    act(() => result.current.runSlash('plain text'));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith('plain text'));
    submitSpy.mockRestore();
  });

  it('onNewChat hook forwards newSession call', () => {
    const localNewChat = vi.fn();
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat: localNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    act(() => result.current.newSession());
    expect(localNewChat).toHaveBeenCalledTimes(1);
  });

  it('clearAllSessions: fetches sessions and deletes each', async () => {
    // 每个测试以 resetMockInvoke() 开始 —— 注册我们自己的 reflect_list_sessions。
    mockInvoke('reflect_list_sessions', async () => [
      { session_id: 'sess-1' },
      { session_id: 'sess-2' },
      { session_id: 'sess-3' },
    ]);
    const delSpy = vi.fn(async () => undefined);
    mockInvoke('reflect_delete_session', delSpy);

    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.clearAllSessions();
    });
    expect(delSpy).toHaveBeenCalledTimes(3);
    expect(delSpy).toHaveBeenCalledWith(
      'reflect_delete_session',
      expect.objectContaining({ id: 'sess-1' }),
    );
    expect(delSpy).toHaveBeenCalledWith(
      'reflect_delete_session',
      expect.objectContaining({ id: 'sess-2' }),
    );

    // 成功 toast 包含计数
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].message).toBe('Cleared 3 session(s).');
    // hook 使查询失效
    await waitFor(() => {
      const state = qc.getQueryState(['sessions']);
      expect(state?.isInvalidated).toBe(true);
    });
  });

  it('clearAllSessions: empty list → info toast', async () => {
    mockInvoke('reflect_list_sessions', async () => []);
    const { result } = renderHook(
      () =>
        usePaletteActions({
          activeId: null,
          onNewChat,
          toasts: TOASTS,
        }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      await result.current.clearAllSessions();
    });
    const toasts = useAgentStore.getState().toasts;
    expect(toasts[toasts.length - 1].message).toBe('No sessions to clear.');
  });
});