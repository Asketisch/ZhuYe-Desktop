/**
 * Vitest —— SideChannelView（Phase 2 条目 1）。
 *
 * 基于模拟 IPC 的冒烟 + 行为测试：
 *   - 页面标题 + 状态徽标渲染
 *   - Start 表单点击打开；以 agent_name + prompt 提交
 *   - 运行中的通道暴露 Cancel 按钮，转发到 reflect_cancel_side_channel
 *   - 终态通道（done/cancelled/error）隐藏 Cancel 按钮
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SideChannelView } from './SideChannelView';
import { createTestQueryClient, emitMockEvent, resetMockInvoke } from '@/test/setup';
import {
  reflect_cancel_side_channel,
  reflect_list_side_channels,
  reflect_start_side_channel,
} from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';

const calls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_list_side_channels: vi.fn(async () => {
      calls.push({ cmd: 'reflect_list_side_channels', args: undefined });
      return [
        {
          id: 'side-running01',
          agentName: 'reviewer',
          prompt: 'audit PR',
          startedAtMs: 1000,
          status: 'running',
          durationMs: null,
        },
        {
          id: 'side-done0002',
          agentName: 'default',
          prompt: 'echo hi',
          startedAtMs: 500,
          status: 'done',
          durationMs: 1234,
        },
      ];
    }),
    reflect_start_side_channel: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_start_side_channel', args });
      return {
        id: 'side-new0003',
        agentName: args.agent_name as string,
        prompt: args.prompt as string,
        startedAtMs: 2000,
      };
    }),
    reflect_cancel_side_channel: vi.fn(async (id: string) => {
      calls.push({ cmd: 'reflect_cancel_side_channel', args: { id } });
      return true;
    }),
    reflect_get_side_channel: vi.fn(async () => null),
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('SideChannelView', () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    resetMockInvoke();
    useAgentStore.getState().reset();
  });

  it('renders the page title and running count badge', async () => {
    render(wrap(<SideChannelView />));
    expect(screen.getByText('Side-channels')).toBeDefined();
    expect(screen.getByText('Each side-channel runs as an independent agent (own cancel token, no main-history writes); terminal states arrive as live events.')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('1 running')).toBeDefined();
    });
  });

  it('renders running + done rows', async () => {
    render(wrap(<SideChannelView />));
    await waitFor(() => {
      expect(screen.getByText('side-running01')).toBeDefined();
      expect(screen.getByText('audit PR')).toBeDefined();
      expect(screen.getByText('echo hi')).toBeDefined();
      expect(screen.getByText('reviewer')).toBeDefined();
      expect(screen.getByText('1.2s')).toBeDefined();
    });
  });

  it('refetches the list when a side_channel lifecycle event arrives on the bus', async () => {
    // v1.x WP9:控制器订阅 `reflect_event` 上的 side_channel_started /
    // side_channel_finished,收到即失效查询缓存 —— 不等 5s 轮询。
    render(wrap(<SideChannelView />));
    await waitFor(() => screen.getByTestId('side-channel-row-side-running01'));
    const listCalls = () => calls.filter((c) => c.cmd === 'reflect_list_side_channels').length;
    const before = listCalls();
    // 总线监听是异步挂上的(mock listen):在 waitFor 里重复投递,
    // 挂上后第一条就会触发 invalidate → refetch。
    await waitFor(() => {
      emitMockEvent('reflect_event', {
        id: '',
        msg: { type: 'side_channel_finished', kind: 'done', id: 'side-running01', finished_at_ms: 2 },
      });
      expect(listCalls()).toBeGreaterThan(before);
    });
  });

  it('ignores unrelated events (no spurious refetch)', async () => {
    render(wrap(<SideChannelView />));
    await waitFor(() => screen.getByTestId('side-channel-row-side-running01'));
    const listCalls = () => calls.filter((c) => c.cmd === 'reflect_list_side_channels').length;
    const before = listCalls();
    emitMockEvent('reflect_event', { id: 'evt', msg: { type: 'agent_message', text: 'hi' } });
    // 给异步 invalidate 一个机会 —— 不应有新的列表调用。
    await new Promise((r) => setTimeout(r, 50));
    expect(listCalls()).toBe(before);
  });

  it('updates a running row to its terminal state from a live finished event', async () => {
    let status: 'running' | 'done' = 'running';
    const originalList = vi
      .mocked(reflect_list_side_channels)
      .getMockImplementation();
    vi.mocked(reflect_list_side_channels).mockImplementation(async () => [
      {
        id: 'side-live0001',
        agentName: 'reviewer',
        prompt: 'audit PR',
        startedAtMs: 1000,
        status,
        durationMs: status === 'running' ? null : 321,
      },
    ]);
    try {
      render(wrap(<SideChannelView />));
      await waitFor(() => screen.getByTestId('side-channel-cancel-side-live0001'));
      status = 'done';
      await waitFor(() => {
        emitMockEvent('reflect_event', {
          id: '',
          msg: {
            type: 'side_channel_finished',
            kind: 'done',
            id: 'side-live0001',
            finished_at_ms: 1321,
          },
        });
        expect(screen.queryByTestId('side-channel-cancel-side-live0001')).toBeNull();
      });
      expect(await screen.findByText('done')).toBeDefined();
      expect(screen.getByText('0.3s')).toBeDefined();
    } finally {
      vi.mocked(reflect_list_side_channels).mockImplementation(originalList!);
    }
  });

  it('running row exposes Cancel; terminal rows do not', async () => {
    render(wrap(<SideChannelView />));
    await waitFor(() => screen.getByTestId('side-channel-row-side-running01'));
    // 运行中的行有取消按钮。
    expect(screen.getByTestId('side-channel-cancel-side-running01')).toBeDefined();
    // 已完成的行没有（终态没有取消按钮）。
    expect(screen.queryByTestId('side-channel-cancel-side-done0002')).toBeNull();
  });

  it('opens the start form and submits with agent_name + prompt', async () => {
    render(wrap(<SideChannelView />));
    // 等待列表渲染完成，避免 Add 按钮与
    // refetchInterval 触发的后续更新冲突。
    await waitFor(() => screen.getByTestId('side-channel-row-side-running01'));
    fireEvent.click(screen.getByTestId('side-channel-add-btn'));
    expect(screen.getByTestId('side-channel-start-form')).toBeDefined();

    fireEvent.change(screen.getByTestId('side-channel-start-name'), {
      target: { value: 'reviewer' },
    });
    fireEvent.change(screen.getByTestId('side-channel-start-prompt'), {
      target: { value: 'double-check the diff' },
    });
    // 点击提交按钮，让 onClick（每次渲染都会调用 start）
    // 在最新状态之后触发。
    fireEvent.click(screen.getByTestId('side-channel-start-submit'));

    await waitFor(
      () => {
        const startCall = calls.find((c) => c.cmd === 'reflect_start_side_channel');
        expect(startCall).toBeDefined();
        expect((startCall?.args as { agent_name: string }).agent_name).toBe('reviewer');
        expect((startCall?.args as { prompt: string }).prompt).toBe('double-check the diff');
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.message.includes('side-new0003'))).toBe(true));
  });

  it('shows serialized backend errors and preserves the draft', async () => {
    vi.mocked(reflect_start_side_channel).mockRejectedValueOnce({ msg: 'agent unavailable' });
    render(wrap(<SideChannelView />));
    fireEvent.click(screen.getByTestId('side-channel-add-btn'));
    fireEvent.change(screen.getByTestId('side-channel-start-prompt'), { target: { value: 'keep me' } });
    fireEvent.click(screen.getByTestId('side-channel-start-submit'));
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.message.includes('agent unavailable'))).toBe(true));
    expect((screen.getByTestId('side-channel-start-prompt') as HTMLInputElement).value).toBe('keep me');
  });

  it('shows serialized cancellation errors', async () => {
    vi.mocked(reflect_cancel_side_channel).mockRejectedValueOnce({ msg: 'cancel unavailable' });
    render(wrap(<SideChannelView />));
    fireEvent.click(await screen.findByTestId('side-channel-cancel-side-running01'));
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.message.includes('cancel unavailable'))).toBe(true));
  });

  it('Cancel click forwards reflect_cancel_side_channel', async () => {
    render(wrap(<SideChannelView />));
    await waitFor(() => screen.getByTestId('side-channel-cancel-side-running01'));
    fireEvent.click(screen.getByTestId('side-channel-cancel-side-running01'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_cancel_side_channel' &&
            (c.args as { id: string }).id === 'side-running01',
        ),
      ).toBe(true);
    });
  });
});
