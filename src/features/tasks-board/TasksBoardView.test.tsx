/**
 * Vitest —— TasksBoardView（Phase 1 多 agent UI）。
 *
 * 基于模拟 IPC 的冒烟 + 行为测试。验证：
 *   - 页面标题 + 空态渲染
 *   - 视图切换（list ↔ board）
 *   - 创建表单打开并以正确的参数提交
 *   - 列表行渲染带操作按钮
 *   - claim / complete / delete 转发到正确的命令
 *
 * 真实 CRUD 在集成测试中对 Tauri 后端执行；本套件锁定
 * 控制器→视图连线 + IPC 调用形状。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TasksBoardView } from './TasksBoardView';
import { createTestQueryClient, resetMockInvoke } from '@/test/setup';

// 跟踪调用，以便断言可以检查 cmd + args。
const calls: Array<{ cmd: string; args: unknown }> = [];
const sessionFixtures: Array<{ session_id: string; title: string; model: string; started_at: string; message_count: number }> = [];
let liveTaskAppeared = false;

vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_list_sessions: vi.fn(async () => sessionFixtures),
    reflect_list_tasks: vi.fn(async (list: string) => {
      calls.push({ cmd: 'reflect_list_tasks', args: { list } });
      if (list === 'default' && liveTaskAppeared) {
        return [{ id: 3, list_id: list, subject: 'Agent created this', description: '', status: 'pending', blocks: [], blocked_by: [], metadata: {}, created_at: 0, updated_at: 0 }];
      }
      return list === 'seeded' || list === 'agent-session-id'
        ? [
            {
              id: 1,
              list_id: list,
              subject: 'Write tests',
              description: '',
              status: 'pending',
              blocks: [],
              blocked_by: [],
              metadata: {},
              created_at: 0,
              updated_at: 0,
            },
            {
              id: 2,
              list_id: list,
              subject: 'Ship it',
              description: '',
              status: 'in_progress',
              blocks: [],
              blocked_by: [],
              metadata: {},
              claimed_by: 'alice',
              created_at: 0,
              updated_at: 0,
            },
          ]
        : [];
    }),
    reflect_list_teams: vi.fn(async () => []),
    reflect_create_task: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_create_task', args });
      return { id: 99, list_id: args.list, subject: args.subject, description: '', status: 'pending', blocks: [], blocked_by: [], metadata: {}, created_at: 0, updated_at: 0 };
    }),
    reflect_claim_task: vi.fn(async (list: string, claimer: string) => {
      calls.push({ cmd: 'reflect_claim_task', args: { list, claimer } });
      return null;
    }),
    reflect_update_task: vi.fn(async (list: string, id: number, patch: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_update_task', args: { list, id, patch } });
      return { task: { id, list_id: list, subject: '', description: '', status: patch.status, blocks: [], blocked_by: [], metadata: {}, created_at: 0, updated_at: 0 }, updatedFields: ['status'], statusChange: { from: 'pending', to: patch.status } };
    }),
    reflect_delete_task: vi.fn(async (list: string, id: number) => {
      calls.push({ cmd: 'reflect_delete_task', args: { list, id } });
    }),
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('TasksBoardView', () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    sessionFixtures.length = 0;
    liveTaskAppeared = false;
    resetMockInvoke();
  });

  it('renders the page title and empty state', async () => {
    render(wrap(<TasksBoardView />));
    expect(screen.getByText('Tasks')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/is empty/i)).toBeDefined();
    });
  });

  it('opens an agent session task list from the session picker', async () => {
    sessionFixtures.push({ session_id: 'agent-session-id', title: 'Agent conversation', model: 'test', started_at: '2026-01-01T00:00:00Z', message_count: 1 });
    const client = createTestQueryClient();
    client.setQueryData(['sessions', { workspace: null }], []);
    render(<QueryClientProvider client={client}><TasksBoardView /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'Agent conversation' }));
    expect(await screen.findByText('Write tests')).toBeDefined();
    expect(calls).toContainEqual({ cmd: 'reflect_list_tasks', args: { list: 'agent-session-id' } });
  });

  it('refreshes the active task list while the board remains open', async () => {
    vi.useFakeTimers();
    try {
      render(wrap(<TasksBoardView />));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const before = calls.filter((call) => call.cmd === 'reflect_list_tasks').length;
      expect(before).toBeGreaterThan(0);
      liveTaskAppeared = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(15_100); });
      expect(calls.filter((call) => call.cmd === 'reflect_list_tasks').length).toBeGreaterThan(before);
      expect(screen.getByText('Agent created this')).toBeDefined();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('opens the create form on Add click', async () => {
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-add-btn'));
    expect(screen.getByTestId('task-create-form')).toBeDefined();
    expect(screen.getByTestId('task-create-subject')).toBeDefined();
  });

  it('submits create with subject + active list', async () => {
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-add-btn'));
    const subject = screen.getByTestId('task-create-subject') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: 'New task' } });
    fireEvent.submit(screen.getByTestId('task-create-form'));

    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_create_task' &&
            (c.args as { subject: string }).subject === 'New task',
        ),
      ).toBe(true);
    });
  });

  it('switches to board view when the list has tasks', async () => {
    render(wrap(<TasksBoardView />));
    // 默认列表 "default" 为空 → 显示空状态，而非看板容器。
    expect(screen.queryByTestId('tasks-board-view')).toBeNull();

    // 切换到预置列表使行记录存在，再切换到看板视图。
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    fireEvent.change(screen.getByTestId('tasks-list-id-input'), {
      target: { value: 'seeded' },
    });
    await waitFor(() => screen.getByText('Write tests'));

    const group = screen.getByRole('radiogroup');
    const radios = group.querySelectorAll('button[role="radio"]');
    expect(radios.length).toBe(2);
    fireEvent.click(radios[1]);

    await waitFor(() => {
      expect(screen.getByTestId('tasks-board-view')).toBeDefined();
    });
  });

  it('renders rows + action buttons for a seeded list', async () => {
    // 在查询触发前将活动列表切换到 "seeded"。
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    const listInput = screen.getByTestId('tasks-list-id-input') as HTMLInputElement;
    fireEvent.change(listInput, { target: { value: 'seeded' } });

    await waitFor(() => {
      expect(screen.getByText('Write tests')).toBeDefined();
      expect(screen.getByText('Ship it')).toBeDefined();
    });

    // 待处理任务暴露 Claim + Delete 操作。
    expect(screen.getByTestId('task-claim-1')).toBeDefined();
    expect(screen.getByTestId('task-delete-1')).toBeDefined();
    // 进行中的任务暴露 Complete + Delete 操作。
    expect(screen.getByTestId('task-complete-2')).toBeDefined();
  });

  it('forwards claim to reflect_claim_task with list + claimer', async () => {
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    fireEvent.change(screen.getByTestId('tasks-list-id-input'), {
      target: { value: 'seeded' },
    });
    await waitFor(() => screen.getByTestId('task-claim-1'));
    fireEvent.click(screen.getByTestId('task-claim-1'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_claim_task' &&
            (c.args as { list: string }).list === 'seeded',
        ),
      ).toBe(true);
    });
  });

  it('forwards complete to reflect_update_task with status=completed', async () => {
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    fireEvent.change(screen.getByTestId('tasks-list-id-input'), {
      target: { value: 'seeded' },
    });
    await waitFor(() => screen.getByTestId('task-complete-2'));
    fireEvent.click(screen.getByTestId('task-complete-2'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_update_task' &&
            (c.args as { id: number; patch: { status: string } }).id === 2 &&
            (c.args as { patch: { status: string } }).patch.status === 'completed',
        ),
      ).toBe(true);
    });
  });

  it('forwards delete to reflect_delete_task', async () => {
    render(wrap(<TasksBoardView />));
    fireEvent.click(screen.getByTestId('tasks-list-picker-toggle'));
    fireEvent.change(screen.getByTestId('tasks-list-id-input'), {
      target: { value: 'seeded' },
    });
    await waitFor(() => screen.getByTestId('task-delete-1'));
    fireEvent.click(screen.getByTestId('task-delete-1'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_delete_task' &&
            (c.args as { list: string; id: number }).id === 1,
        ),
      ).toBe(true);
    });
  });
});
