/**
 * Vitest —— ScheduleView（Phase 1 条目 2）。
 *
 * 基于模拟 IPC 的冒烟 + 行为测试。验证：
 *   - 页面标题 + 空态渲染
 *   - 状态查询解析后状态徽标渲染
 *   - 创建表单打开并以正确的参数提交
 *   - 任务行渲染带切换 / 移除按钮
 *   - 切换转发到 reflect_update_schedule，enabled 取反
 *   - remove 转发到 reflect_remove_schedule
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScheduleView } from './ScheduleView';
import { createTestQueryClient, resetMockInvoke } from '@/test/setup';
import { reflect_add_schedule, reflect_remove_schedule } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';

const calls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_list_schedules: vi.fn(async () => {
      calls.push({ cmd: 'reflect_list_schedules', args: undefined });
      return [
        {
          id: 'job-1',
          schedule: '0 * * * *',
          prompt: 'standup',
          name: 'daily',
          enabled: true,
          created_at: '2026-07-28T00:00:00Z',
          last_fired: null,
          next_fire: '2026-07-28T01:00:00Z',
        },
      ];
    }),
    reflect_get_schedule_status: vi.fn(async () => {
      calls.push({ cmd: 'reflect_get_schedule_status', args: undefined });
      return { status: 'has_jobs', line: 'cron-scheduler: 1 job', total: 1, enabled: 1 };
    }),
    reflect_add_schedule: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_add_schedule', args });
      return { id: 'new-1', schedule: args.schedule, prompt: args.prompt, name: args.name, enabled: true, created_at: '2026-07-28T00:00:00Z' };
    }),
    reflect_update_schedule: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_update_schedule', args });
      return { id: args.id, schedule: '0 * * * *', prompt: 'standup', enabled: args.enabled, created_at: '2026-07-28T00:00:00Z' };
    }),
    reflect_remove_schedule: vi.fn(async (id: string) => {
      calls.push({ cmd: 'reflect_remove_schedule', args: { id } });
      return true;
    }),
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('ScheduleView', () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    resetMockInvoke();
    useAgentStore.getState().reset();
  });

  it('renders the page title and seeded job', async () => {
    render(wrap(<ScheduleView />));
    expect(screen.getByText('Schedule')).toBeDefined();
    expect(screen.getByText('Cron expressions use UTC. Jobs are kept in memory and are lost when the app exits.')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('standup')).toBeDefined();
    });
  });

  it('renders the status badge once status resolves', async () => {
    render(wrap(<ScheduleView />));
    await waitFor(() => {
      expect(screen.getByText('1/1 active')).toBeDefined();
    });
  });

  it('opens the create form on Add click', async () => {
    render(wrap(<ScheduleView />));
    fireEvent.click(screen.getByTestId('schedule-add-btn'));
    expect(screen.getByTestId('schedule-create-form')).toBeDefined();
    expect(screen.getByTestId('schedule-create-schedule')).toBeDefined();
  });

  it('submits create with schedule + prompt + name', async () => {
    render(wrap(<ScheduleView />));
    fireEvent.click(screen.getByTestId('schedule-add-btn'));
    fireEvent.change(screen.getByTestId('schedule-create-prompt'), {
      target: { value: 'hello cron' },
    });
    fireEvent.submit(screen.getByTestId('schedule-create-form'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_add_schedule' &&
            (c.args as { prompt: string }).prompt === 'hello cron',
        ),
      ).toBe(true);
    });
  });

  it('forwards toggle to reflect_update_schedule with enabled flipped', async () => {
    render(wrap(<ScheduleView />));
    await waitFor(() => screen.getByTestId('schedule-toggle-job-1'));
    fireEvent.click(screen.getByTestId('schedule-toggle-job-1'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_update_schedule' &&
            (c.args as { id: string; enabled: boolean }).id === 'job-1' &&
            (c.args as { enabled: boolean }).enabled === false,
        ),
      ).toBe(true);
    });
  });

  it('forwards remove to reflect_remove_schedule', async () => {
    render(wrap(<ScheduleView />));
    await waitFor(() => screen.getByTestId('schedule-remove-job-1'));
    fireEvent.click(screen.getByTestId('schedule-remove-job-1'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_remove_schedule' &&
            (c.args as { id: string }).id === 'job-1',
        ),
      ).toBe(true);
    });
  });

  it('retains the draft and displays serialized creation errors', async () => {
    vi.mocked(reflect_add_schedule).mockRejectedValueOnce({ msg: 'invalid cron' });
    render(wrap(<ScheduleView />));
    fireEvent.click(screen.getByTestId('schedule-add-btn'));
    fireEvent.change(screen.getByTestId('schedule-create-prompt'), { target: { value: 'keep draft' } });
    fireEvent.submit(screen.getByTestId('schedule-create-form'));
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.message.includes('invalid cron'))).toBe(true));
    expect((screen.getByTestId('schedule-create-prompt') as HTMLInputElement).value).toBe('keep draft');
  });

  it('reports a missing job instead of claiming it was removed', async () => {
    vi.mocked(reflect_remove_schedule).mockResolvedValueOnce(false);
    render(wrap(<ScheduleView />));
    fireEvent.click(await screen.findByTestId('schedule-remove-job-1'));
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.kind === 'warn' && toast.message.includes('already removed'))).toBe(true));
  });

  it('disables create while its request is pending', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof reflect_add_schedule>>) => void;
    vi.mocked(reflect_add_schedule).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(wrap(<ScheduleView />));
    fireEvent.click(screen.getByTestId('schedule-add-btn'));
    fireEvent.change(screen.getByTestId('schedule-create-prompt'), { target: { value: 'once' } });
    fireEvent.submit(screen.getByTestId('schedule-create-form'));
    await waitFor(() => expect((screen.getByTestId('schedule-create-submit') as HTMLButtonElement).disabled).toBe(true));
    resolve({ id: 'created', schedule: '0 * * * *', prompt: 'once', enabled: true, created_at: '2026-07-28T00:00:00Z' });
    await waitFor(() => expect(screen.queryByTestId('schedule-create-form')).toBeNull());
  });
});
