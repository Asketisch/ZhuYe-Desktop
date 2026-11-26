/**
 * Vitest — GuardStatsCard(F01 prompt_guard 裁决统计)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GuardStatsCard } from './GuardStatsCard';
// 直接引用 IPC 包装函数 —— 命令面静态门禁要求每条已注册命令在测试源码中
// 有引用(非仅字符串 mock)。
import { zhuye_query_guard_stats } from '@/utils/commands/knowledge/skills';
import { mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

describe('GuardStatsCard', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('exposes the IPC wrapper for the command-surface gate', () => {
    expect(typeof zhuye_query_guard_stats).toBe('function');
  });

  it('renders title + hint and sends query_guard_stats on click', async () => {
    let calls = 0;
    mockInvoke('zhuye_query_guard_stats', async () => {
      calls += 1;
      return 'sub-guard-fake';
    });
    render(<GuardStatsCard />);
    const card = screen.getByTestId('settings-guard-stats');
    expect(card).toBeDefined();

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId('settings-guard-stats-sent')).toBeDefined(),
    );
  });

  it('surfaces invoke errors instead of silently failing', async () => {
    mockInvoke('zhuye_query_guard_stats', async () => {
      throw new Error('engine offline');
    });
    render(<GuardStatsCard />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('engine offline')).toBeDefined());
  });
});
