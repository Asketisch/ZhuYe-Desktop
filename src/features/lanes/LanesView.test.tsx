/**
 * LanesView —— harness 泳道页切片测试(mock IPC + store 直填)。
 *
 * 覆盖:
 *   - 每个子代理快照一条泳道(store `subagents.lastStatus` 投影)+ 空态
 *   - side-channel 泳道与汇总行(在途 / 已完成 / 失败)
 *   - 中止全部:side-channel 走 cancel、运行中子代理走 interrupt
 *   - 手动刷新触发 `reflect_query_subagents`
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { LanesView } from './LanesView';
import { useAgentStore } from '@/stores/agentStore';
import type { SubagentStatusSnapshot } from '@/types/protocol';
import { createTestQueryClient, resetMockInvoke, mockInvoke } from '@/test/setup';
import type { ReactNode } from 'react';

// binding 里的返回按钮用 useNavigate;测试无 Router 上下文,替换为 no-op。
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

/** 各命令的调用记录。 */
const calls: Record<string, unknown[]> = {};

function record(cmd: string, args: unknown): void {
  (calls[cmd] ??= []).push(args);
}

/** 播入子代理快照 + side-channel mock。 */
function seedLanes(opts: { children?: SubagentStatusSnapshot[]; channels?: unknown[] } = {}) {
  const children = opts.children ?? [
    {
      child_id: 'child-1',
      role: 'explorer',
      state: 'running',
      started_at: new Date(Date.now() - 60_000).toISOString(),
      iteration: 2,
      current_tool: 'read_file',
      total_tokens: 2048,
      last_event: 'reading src/index.ts',
    },
    {
      child_id: 'child-2',
      role: 'reviewer',
      state: 'completed',
      started_at: new Date(Date.now() - 120_000).toISOString(),
      finished_at: new Date(Date.now() - 30_000).toISOString(),
      iteration: 4,
      total_tokens: 512,
    },
    {
      child_id: 'child-3',
      role: 'fixer',
      state: 'failed',
      started_at: new Date(Date.now() - 90_000).toISOString(),
      finished_at: new Date(Date.now() - 60_000).toISOString(),
      iteration: 1,
      total_tokens: 64,
    },
  ];
  useAgentStore.setState({
    loadedSessionId: 'sess-abcd1234',
    subagents: { feed: [], lastStatus: children },
  });
  mockInvoke('reflect_list_side_channels', async () => opts.channels ?? []);
  mockInvoke('reflect_query_subagents', async (_cmd: string, args: unknown) => {
    record('reflect_query_subagents', args);
    return 'sub-fake';
  });
  mockInvoke('reflect_interrupt', async (_cmd: string, args: unknown) => {
    record('reflect_interrupt', args);
    return 'interrupted';
  });
  mockInvoke('reflect_cancel_side_channel', async (_cmd: string, args: unknown) => {
    record('reflect_cancel_side_channel', args);
    return true;
  });
}

function QueryWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function renderView() {
  return render(
    <QueryWrapper>
      <I18nProvider>
        <LanesView />
      </I18nProvider>
    </QueryWrapper>,
  );
}

describe('LanesView', () => {
  beforeEach(() => {
    cleanup();
    for (const key of Object.keys(calls)) delete calls[key];
    resetMockInvoke();
    useAgentStore.getState().reset();
  });

  it('renders one lane per subagent snapshot with summary counts', async () => {
    seedLanes();
    renderView();

    await waitFor(() => expect(screen.getByTestId('lanes-record-0')).toBeDefined());
    expect(screen.getByTestId('lanes-record-1')).toBeDefined();
    expect(screen.getByTestId('lanes-record-2')).toBeDefined();

    // 名字与任务摘要进 DOM。
    expect(screen.getByText('explorer')).toBeDefined();
    expect(screen.getByText('reviewer')).toBeDefined();
    expect(screen.getByText('fixer')).toBeDefined();
    expect(screen.getByText('reading src/index.ts')).toBeDefined();

    // 汇总:在途 1 · 已完成 1 · 失败 1;头部副标题带会话短 id。
    const sum = screen.getByTestId('lanes-sum');
    expect(sum.textContent).toContain('1');
    const sub = screen.getByTestId('lanes-view').textContent ?? '';
    expect(sub).toContain('sess-abc');
    expect(sub).toContain('1 in flight / 16');

    // 指标:运行中子代理的 token 用量(2048 → 2.0k tok)。
    expect(screen.getByText('2.0k tok')).toBeDefined();
  });

  it('merges side-channel lanes into the same list', async () => {
    seedLanes({
      children: [],
      channels: [
        { id: 'side-1', agentName: 'reviewer', prompt: 'audit PR', startedAtMs: Date.now() - 5000, status: 'running', durationMs: null },
        { id: 'side-2', agentName: 'default', prompt: 'echo hi', startedAtMs: Date.now() - 9000, status: 'done', durationMs: 1234 },
      ],
    });
    renderView();

    await waitFor(() => expect(screen.getByText('audit PR')).toBeDefined());
    expect(screen.getByText('echo hi')).toBeDefined();
    // side-channel 的已完成时长(1234ms → 1.2s)。
    expect(screen.getByText('1.2s')).toBeDefined();
    // 汇总:在途 1 · 已完成 1 · 失败 0。
    const sumText = screen.getByTestId('lanes-sum').textContent ?? '';
    expect(sumText).toContain('Failed');
    expect(screen.getByText('1 / 16')).toBeDefined();
  });

  it('shows the empty state when no subagent or channel activity exists', async () => {
    seedLanes({ children: [], channels: [] });
    renderView();
    await waitFor(() => expect(screen.getByTestId('lanes-empty')).toBeDefined());
    expect(screen.getByText('No subagent activity in this session yet.')).toBeDefined();
  });

  it('cancel all cancels running side channels and interrupts running children', async () => {
    seedLanes({
      channels: [
        { id: 'side-1', agentName: 'reviewer', prompt: 'audit PR', startedAtMs: Date.now() - 5000, status: 'running', durationMs: null },
      ],
    });
    renderView();
    await waitFor(() => expect(screen.getByText('audit PR')).toBeDefined());

    const btn = screen.getByTestId('lanes-cancel-all');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => expect(calls.reflect_cancel_side_channel?.[0]).toEqual({ id: 'side-1' }));
    await waitFor(() => expect(calls.reflect_interrupt?.[0]).toEqual({ childId: 'child-1' }));
  });

  it('refresh button triggers reflect_query_subagents', async () => {
    seedLanes();
    renderView();
    await waitFor(() => expect(screen.getByTestId('lanes-record-0')).toBeDefined());

    // 挂载本身已拉过一次快照;手动刷新再拉一次。
    const before = calls.reflect_query_subagents.length;
    fireEvent.click(screen.getByTestId('lanes-refresh'));
    await waitFor(() => expect(calls.reflect_query_subagents.length).toBeGreaterThan(before));
  });
});
