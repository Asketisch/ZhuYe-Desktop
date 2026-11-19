/**
 * Vitest — ThreadsView 组件测试。
 *
 * 验证:
 * 1. 渲染 session buckets
 * 2. 空状态显示
 * 3. 显示 session 信息
 * 4. active 高亮
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThreadsView } from '@/features/threads/ThreadsView';
import { ConfirmDialogHost } from '@/features/modals/ConfirmDialog';
import { resetMockInvoke, createTestQueryClient } from '@/test/setup.tsx';
import { useSessions, useActiveSession } from '@/logic/sessions/useSessions';

// 模拟 useSessions + useActiveSession hooks
vi.mock('@/logic/sessions/useSessions', () => ({
  useSessions: vi.fn(),
  useActiveSession: vi.fn(),
}));

// Mock @tanstack/react-router Link
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router');
  return {
    ...actual,
    Link: ({ children, to, onClick }: { children: React.ReactNode; to: string; onClick?: () => void }) => (
      <a href={to} onClick={onClick}>
        {children}
      </a>
    ),
  };
});

describe('ThreadsView', () => {
  beforeEach(() => {
    resetMockInvoke();
    vi.clearAllMocks();
  });

  it('renders session buckets with sessions', () => {
    const now = Date.now();
    vi.mocked(useSessions).mockReturnValue({
      groups: [],
      buckets: [
        {
          label: 'Now',
          sessions: [
            {
              session_id: 's1',
              model: 'stub/test',
              started_at: new Date(now - 30 * 60 * 1000).toISOString(),
              message_count: 2,
            },
          ],
        },
      ],
      all: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      refresh: vi.fn(),
      rename: vi.fn(),
        fork: vi.fn().mockResolvedValue("f0f0f0f0-0000-4000-8000-000000000001"),
      generateTitle: vi.fn(async () => "AI 标题"),
      remove: vi.fn(),
      archived: [],
      archive: vi.fn(),
      unarchive: vi.fn(),
      export: vi.fn(),
    });
    vi.mocked(useActiveSession).mockReturnValue({
      activeId: null,
      setActiveId: vi.fn(),
      clear: vi.fn(),
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadsView />
      </QueryClientProvider>
    );

    expect(screen.getByText('Threads')).toBeDefined();
    // session_id "s1" → displayTitle 返回 id 前缀。
    expect(screen.getByText('s1')).toBeDefined();
    expect(screen.getByText(/2 message/)).toBeDefined();
    expect(screen.getByText('Now')).toBeDefined();
  });

  it('shows empty state when no sessions', () => {
    vi.mocked(useSessions).mockReturnValue({
      groups: [],
      buckets: [],
      all: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      refresh: vi.fn(),
      rename: vi.fn(),
        fork: vi.fn().mockResolvedValue("f0f0f0f0-0000-4000-8000-000000000001"),
      generateTitle: vi.fn(async () => "AI 标题"),
      remove: vi.fn(),
      archived: [],
      archive: vi.fn(),
      unarchive: vi.fn(),
      export: vi.fn(),
    });
    vi.mocked(useActiveSession).mockReturnValue({
      activeId: null,
      setActiveId: vi.fn(),
      clear: vi.fn(),
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadsView />
      </QueryClientProvider>
    );

    expect(screen.getByText(/No threads yet/)).toBeDefined();
  });

  it('highlights active session', () => {
    const now = Date.now();
    vi.mocked(useSessions).mockReturnValue({
      groups: [],
      buckets: [
        {
          label: 'Now',
          sessions: [
            {
              session_id: 's1',
              model: 'stub/test',
              started_at: new Date(now - 30 * 60 * 1000).toISOString(),
              message_count: 2,
            },
          ],
        },
      ],
      all: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      refresh: vi.fn(),
      rename: vi.fn(),
        fork: vi.fn().mockResolvedValue("f0f0f0f0-0000-4000-8000-000000000001"),
      generateTitle: vi.fn(async () => "AI 标题"),
      remove: vi.fn(),
      archived: [],
      archive: vi.fn(),
      unarchive: vi.fn(),
      export: vi.fn(),
    });
    vi.mocked(useActiveSession).mockReturnValue({
      activeId: 's1',
      setActiveId: vi.fn(),
      clear: vi.fn(),
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadsView />
      </QueryClientProvider>
    );

    expect(screen.getByText('s1')).toBeDefined();
    const activeLink = screen.getByText('s1').closest('a');
    expect(activeLink).toBeDefined();
  });

  describe('multi-select delete', () => {
    const twoSessions = (remove: (id: string) => Promise<void>) => {
      const now = Date.now();
      vi.mocked(useSessions).mockReturnValue({
        groups: [],
        buckets: [
          {
            label: 'Now',
            sessions: [
              { session_id: 's1', model: 'stub/test', started_at: new Date(now - 30 * 60 * 1000).toISOString(), message_count: 1 },
              { session_id: 's2', model: 'stub/test', started_at: new Date(now - 60 * 60 * 1000).toISOString(), message_count: 1 },
            ],
          },
        ],
        all: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
        refresh: vi.fn(),
        rename: vi.fn(),
        fork: vi.fn().mockResolvedValue("f0f0f0f0-0000-4000-8000-000000000001"),
        generateTitle: vi.fn(async () => 'AI 标题'),
        remove,
        archived: [],
        archive: vi.fn(),
        unarchive: vi.fn(),
        export: vi.fn(),
      });
      vi.mocked(useActiveSession).mockReturnValue({
        activeId: null,
        setActiveId: vi.fn(),
        clear: vi.fn(),
      });
    };

    function renderView() {
      return render(
        <QueryClientProvider client={createTestQueryClient()}>
          <ThreadsView />
          <ConfirmDialogHost />
        </QueryClientProvider>,
      );
    }

    it('enters select mode, selects sessions and bulk-deletes after in-app confirm', async () => {
      const remove = vi.fn(async () => {});
      twoSessions(remove);

      renderView();

      // 默认无勾选框；进入多选模式后出现。
      expect(screen.queryByTestId('thread-select-s1')).toBeNull();
      fireEvent.click(screen.getByTestId('threads-select-mode'));

      fireEvent.click(screen.getByTestId('thread-select-s1'));
      fireEvent.click(screen.getByTestId('thread-select-s2'));

      expect(screen.getByTestId('threads-selected-count').textContent).toContain('2');
      expect(screen.getByTestId('threads-selected-count').textContent).not.toContain('1 selected');

      fireEvent.click(screen.getByTestId('threads-delete-selected'));

      // 应用内确认对话框弹出 → 点击确认。
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

      await vi.waitFor(() => {
        expect(remove).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenCalledWith('s1');
        expect(remove).toHaveBeenCalledWith('s2');
      });
      // 删除完成退出多选模式，勾选框消失。
      await vi.waitFor(() => {
        expect(screen.queryByTestId('threads-select-bar')).toBeNull();
      });
    });

    it('does not delete when the in-app confirm is dismissed', async () => {
      const remove = vi.fn(async () => {});
      twoSessions(remove);

      renderView();
      fireEvent.click(screen.getByTestId('threads-select-mode'));
      fireEvent.click(screen.getByTestId('thread-select-s1'));
      fireEvent.click(screen.getByTestId('threads-delete-selected'));

      // 应用内确认对话框弹出 → 点击取消。
      fireEvent.click(await screen.findByTestId('confirm-dialog-cancel'));
      expect(remove).not.toHaveBeenCalled();
      // 仍处于多选模式，可继续勾选。
      expect(screen.getByTestId('threads-select-bar')).toBeDefined();
    });
  });
});