/**
 * Vitest — F50 多会话 Dashboard(聚合纯函数 + 渲染)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionsDashboard, aggregate } from './SessionsDashboard';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

const DAY = 86_400_000;

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('aggregate(纯函数)', () => {
  const now = 10 * DAY;

  it('totals and window activity', () => {
    const stats = aggregate(
      [
        { thread_id: 'a', name: 'A', created_at: 0, updated_at: now, message_count: 10, token_total: 100 },
        { thread_id: 'b', name: 'B', created_at: 0, updated_at: now - 2 * DAY, message_count: 5, token_total: 50 },
        { thread_id: 'c', name: 'C', created_at: 0, updated_at: now - 30 * DAY, message_count: 1, token_total: 10 },
      ],
      now,
    );
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalMessages).toBe(16);
    expect(stats.totalTokens).toBe(160);
    // 30 天前的会话不计入 7 天窗口
    expect(stats.activeInWindow).toBe(2);
    expect(stats.top[0]).toEqual({ id: 'a', name: 'A', messages: 10 });
  });

  it('byDay indexes by days-ago', () => {
    const stats = aggregate(
      [
        { thread_id: 'a', name: '', created_at: 0, updated_at: now, message_count: 0, token_total: 0 },
        { thread_id: 'b', name: '', created_at: 0, updated_at: now - DAY, message_count: 0, token_total: 0 },
      ],
      now,
    );
    expect(stats.byDay[0]).toBe(1);
    expect(stats.byDay[1]).toBe(1);
    expect(stats.byDay.slice(2).every((v) => v === 0)).toBe(true);
  });

  it('empty sessions → zero stats and no top', () => {
    const stats = aggregate([], now);
    expect(stats.totalSessions).toBe(0);
    expect(stats.top).toEqual([]);
  });

  it('top capped at 5', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({
      thread_id: `s${i}`,
      name: `S${i}`,
      created_at: 0,
      updated_at: now,
      message_count: i + 1,
      token_total: 0,
    }));
    expect(aggregate(sessions, now).top.length).toBe(5);
  });

  it('unnamed falls back to thread_id', () => {
    const stats = aggregate(
      [{ thread_id: 'abc', name: '', created_at: 0, updated_at: now, message_count: 1, token_total: 0 }],
      now,
    );
    expect(stats.top[0].name).toBe('abc');
  });
});

describe('SessionsDashboard 组件', () => {
  beforeEach(() => resetMockInvoke());
  afterEach(() => cleanup());

  it('hidden when no sessions', () => {
    mockInvoke('zhuye_list_sessions', async () => []);
    render(wrap(<SessionsDashboard />));
    expect(screen.queryByTestId('sessions-dashboard')).toBeNull();
  });

  it('renders stats grid and top list', async () => {
    mockInvoke('zhuye_list_sessions', async () => [
      { thread_id: 'a', name: 'Alpha', created_at: 0, updated_at: Date.now(), message_count: 12, token_total: 100 },
    ]);
    render(wrap(<SessionsDashboard />));
    await screen.findByTestId('sessions-dashboard');
    expect(screen.getByTestId('dashboard-total-messages').textContent).toContain('12');
    expect(screen.getByTestId('dashboard-top').textContent).toContain('Alpha');
  });
});
