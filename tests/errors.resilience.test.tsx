/**
 * 错误韧性 —— 真实故障注入下的应用行为。
 *
 * 场景：
 *   - 流中断（stream_error）→ 错误项进入转写 + turn 可继续
 *   - 配额耗尽（quota_exhausted）→ 警告 toast + agent 停止语义
 *   - 会话级 error → lastError 通道
 *   - 列表加载故障 → 侧边栏错误展示 + Refresh 按钮恢复
 *   - 提交链路故障（reflect_submit 抛错）→ Composer 报错 toast，不丢输入语义
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

async function typeAndSend(text: string): Promise<void> {
  const textarea = await screen.findByLabelText('Message Reflect');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

describe('stream errors mid-conversation', () => {
  it('stream_error appends an error item to the turn transcript', async () => {
    backend.agent.script = [
      { emit: { type: 'agent_message_delta', delta: 'partial answer' } },
      {
        emit: {
          type: 'stream_error',
          code: 'E_CONN_RESET',
          message: 'upstream connection reset',
          retry_in_ms: 3000,
          provider: 'anthropic',
        },
      },
      { emit: { type: 'turn_complete', turn_id: 't-e1', usage: {}, status: 'success' } },
    ];

    renderApp();
    await typeAndSend('vulnerable question');

    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('partial answer'));
    await waitFor(() =>
      expect(screen.getByRole('log').textContent).toContain('upstream connection reset'),
    );
    // turn 仍正常收尾（错误不阻断生命周期）。
    await waitFor(() => {
      const turns = useAgentStore.getState().turns;
      expect(turns[turns.length - 1].status).toBe('done');
    });
  });

  it('session-level error (empty id) routes to lastError, not transcript', async () => {
    renderApp();
    emitEvent('', { type: 'error', code: 'E_DAEMON', message: 'agent daemon crashed' });

    await waitFor(() => expect(useAgentStore.getState().lastError).toBe('E_DAEMON: agent daemon crashed'));
    // 转写不受污染。
    expect(useAgentStore.getState().turns.length).toBe(0);
  });
});

describe('quota exhaustion', () => {
  it('raises a warning toast with usage numbers and reset window', async () => {
    renderApp();
    emitEvent('', {
      type: 'quota_exhausted',
      provider: 'anthropic',
      label: 'org-key',
      used_tokens: 99_000,
      max_tokens: 100_000,
      window_ends_secs: 30 * 60,
    });

    await waitFor(() => {
      const toast = useAgentStore.getState().toasts.find((t) => t.kind === 'warn');
      expect(toast?.message).toContain('anthropic/org-key');
      expect(toast?.message).toContain('99000/100000');
      expect(toast?.message).toContain('30min');
    });
  });
});

describe('backend failures & recovery', () => {
  it('sessions list failure shows error; Refresh button recovers when backend heals', async () => {
    backend.state.failures['reflect_list_sessions'] = new Error('database locked');
    renderApp();

    const sidebar = await screen.findByTestId('shell-sidebar');
    await waitFor(() => expect(sidebar.textContent).toContain('database locked'));

    // 后端自愈。
    delete backend.state.failures['reflect_list_sessions'];
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => expect(sidebar.textContent).toContain('Fix login bug'));
    expect(sidebar.textContent).not.toContain('database locked');
  });

  it('reflect_submit failure surfaces an error toast from the composer path', async () => {
    backend.state.failures['reflect_submit'] = new Error('submission channel closed');
    renderApp();

    await typeAndSend('doomed message');

    await waitFor(() =>
      expect(
        useAgentStore.getState().toasts.some(
          (t) => t.kind === 'error' && t.message.includes('submission channel closed'),
        ),
      ).toBe(true),
    );
  });

  it('approval IPC failure keeps the request available for retry', async () => {
    renderApp();
    emitEvent('sub-err', {
      type: 'approval_request',
      request_id: 'apr-err',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'ls' } },
    });
    await screen.findByText('Tool Approval');

    backend.state.failures['reflect_tool_approval'] = new Error('approval bus down');
    fireEvent.click(screen.getByText('Approve'));
    expect((await screen.findByRole('alert')).textContent).toContain('approval bus down');
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(1);

    delete backend.state.failures['reflect_tool_approval'];
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(useAgentStore.getState().pendingApprovals).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText('Tool Approval')).toBeNull());
  });
});

describe('interrupted turn lifecycle', () => {
  it('turn_aborted marks the turn and user can start a new one', async () => {
    backend.agent.script = [{ emit: { type: 'agent_message_delta', delta: 'being cut off' } }];
    renderApp();

    await typeAndSend('long running');
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('being cut off'));

    const subId = backend.agent.submissions[0].id;
    emitEvent(subId, { type: 'turn_aborted', turn_id: 't-x', reason: { type: 'shutdown' } });
    await waitFor(() =>
      expect(useAgentStore.getState().turns[0].status).toBe('aborted'),
    );

    // 用户立即开启新 turn。
    backend.agent.script = [{ emit: { type: 'agent_message_delta', delta: 'fresh start' } }];
    await typeAndSend('new question');
    const turns = useAgentStore.getState().turns;
    await waitFor(() => expect(turns.length).toBe(2));
    expect(turns[1].status).toBe('streaming');
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('fresh start'));
  });
});

