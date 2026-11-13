/**
 * 聊天主流程 —— 真实应用级端到端测试。
 *
 * 挂载完整应用（AppProviders + RouterProvider + 真实路由表），用户在
 * Composer 输入并回车 → store.submit → reflect_submit → ScriptedAgent
 * 按编排回放事件流 → reducer → MessageList/StatusBar/ModalStack 实时渲染。
 * 中途包含一次工具审批 gate：agent 暂停，用户在 ApprovalModal 点批准，
 * agent 才继续 —— 完整复刻真实人机交互回路。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/** 在 Composer 输入文本并回车提交（真实键盘路径）。 */
async function typeAndSend(text: string): Promise<void> {
  const textarea = await screen.findByLabelText('Message ZhuYe');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

describe('chat full conversation flow (real app mount)', () => {
  it('streams a reply with tool use, gated approval, completion and tokens', async () => {
    // 编排 agent 行为：思考 → 流式 → 工具(需审批) → gate → 工具结果 → 收尾。
    backend.agent.script = [
      { emit: { type: 'thinking_delta', delta: 'analyzing the request' } },
      { emit: [{ type: 'agent_message_delta', delta: 'Let me check ' }, { type: 'agent_message_delta', delta: 'the file.' }] },
      {
        emit: {
          type: 'tool_call_begin',
          call_id: 'call-run',
          tool_name: 'bash',
          args: { cmd: 'cargo test --lib' },
        },
      },
      {
        emit: {
          type: 'approval_request',
          request_id: 'apr-run',
          kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'cargo test --lib' } },
          risk: 'high',
        },
      },
      { gate: 'tool_approval', id: 'apr-run' },
      {
        emit: {
          type: 'tool_call_end',
          call_id: 'call-run',
          is_error: false,
          elapsed_ms: 1200,
          output: {
            content: [{ type: 'text', text: '18 passed; 0 failed' }],
            is_error: false,
            metadata: null,
            elapsed_ms: 1200,
          },
        },
      },
      { emit: { type: 'agent_message_delta', delta: 'All tests pass.' } },
      {
        emit: [
          { type: 'turn_complete', turn_id: 't-1', usage: {}, status: 'success' },
          {
            type: 'token_count',
            input_tokens: 500,
            output_tokens: 250,
            cached_tokens: 100,
            cache_write_tokens: 0,
            total_tokens: 750,
            cost_usd: 0.004,
            provider: 'anthropic',
            credential_label: 'main',
          },
        ],
      },
    ];

    renderApp();

    // 1. 用户发送消息 —— 走真实 Composer 键盘路径。
    await typeAndSend('run the tests');

    // 2. reflect_submit 收到完整 Submission 信封。
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    const submission = backend.agent.submissions[0];
    expect(submission.op).toEqual({
      type: 'user_input',
      items: [{ type: 'text', text: 'run the tests' }],
    });

    // 3. 用户消息 + 助手流式文本出现在消息流。
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.textContent).toContain('run the tests'));
    await waitFor(() => expect(log.textContent).toContain('the file.'));

    // 4. 工具调用渲染为 running 状态。
    await waitFor(() => expect(log.textContent).toContain('bash'));

    // 5. 审批以 composer 接管卡出现(v2),agent 在 gate 处暂停(未收到决策)。
    const card = await screen.findByTestId('zcode-approval');
    expect(within(card).getByText(/bash/)).toBeDefined();
    expect(backend.agent.toolApprovals.length).toBe(0);

    // 6. 用户点 允许一次 —— 决策以 'approve' 线格式发往后端。
    fireEvent.click(within(card).getByTestId('zcode-approval-allow'));
    await waitFor(() => expect(backend.agent.toolApprovals.length).toBe(1));
    expect(backend.agent.toolApprovals[0]).toEqual({ id: 'apr-run', decision: 'approve' });

    // 7. gate 放行：工具结果进入 store（tool_output 折叠渲染，不直接进 DOM），
    //    收尾文本是普通 assistant 文本，出现在消息流。
    await waitFor(() => {
      const turns = useAgentStore.getState().turns;
      const last = turns[turns.length - 1];
      const output = last.items.find((i) => i.kind === 'tool_output');
      expect(output && output.kind === 'tool_output' ? output.text : '').toContain('18 passed');
    });
    await waitFor(() => expect(log.textContent).toContain('All tests pass.'));

    // 8. 弹窗已关闭（pendingApprovals 清空）。
    await waitFor(() => expect(useAgentStore.getState().pendingApprovals.length).toBe(0));

    // 9. token 统计落入 store（StatusBar 消费）。
    await waitFor(() => expect(useAgentStore.getState().tokens?.total).toBe(750));

    // 10. turn 状态 done，ScriptedAgent 编排执行完毕。
    await waitFor(() => expect(backend.agent.finished).toBe(true));
    const turns = useAgentStore.getState().turns;
    expect(turns[turns.length - 1].status).toBe('done');
  }, 20_000);

  it('interrupt mid-stream aborts the turn and notifies the backend', async () => {
    // 编排一个长流，不收尾 —— 模拟被打断。
    backend.agent.script = [
      { emit: { type: 'agent_message_delta', delta: 'long output...' } },
    ];

    renderApp();
    await typeAndSend('tell me something long');

    await waitFor(() =>
      expect(screen.getByRole('log').textContent).toContain('long output'),
    );

    // 用户触发 interrupt（store action，StatusBar/Composer 的停止按钮同路径）。
    await useAgentStore.getState().interrupt();
    expect(backend.callsOf('reflect_interrupt').length).toBe(1);

    // 模拟后端确认中断：turn_aborted。
    const turnId = backend.agent.submissions[0].id;
    emitEvent(turnId, { type: 'turn_aborted', turn_id: 't-2', reason: { type: 'user_interrupt' } });
    await waitFor(() => {
      const turns = useAgentStore.getState().turns;
      expect(turns[turns.length - 1].status).toBe('aborted');
    });
  }, 20_000);

  it('second submission preempts the previous script (stale flows do not leak)', async () => {
    backend.agent.script = [
      { emit: { type: 'agent_message_delta', delta: 'first reply' } },
      { gate: 'question', id: 'never-answered' }, // 永不满足的 gate
      { emit: { type: 'agent_message_delta', delta: 'SHOULD NOT APPEAR' } },
    ];

    renderApp();
    await typeAndSend('first');
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('first reply'));
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));

    // 用户立刻发第二条 —— turn 仍在运行，消息进入前端待发送队列
    // （不发后端、不进消息流 turns）。
    await typeAndSend('second');
    await screen.findByTestId('queued-messages');
    expect(backend.agent.submissions.length).toBe(1);

    // 「立即发送」直接提交 —— 旧编排被抢占，不再产生事件。
    fireEvent.click(screen.getByTestId('queued-send-0'));
    await waitFor(() => expect(backend.agent.submissions.length).toBe(2));
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.textContent).toContain('second'));
    await new Promise((r) => setTimeout(r, 30));
    expect(log.textContent).not.toContain('SHOULD NOT APPEAR');
  }, 20_000);

  it('agent errors surface in the transcript (turn-scoped error item)', async () => {
    backend.agent.script = [
      {
        emit: {
          type: 'error',
          code: 'E_TOOL_PANIC',
          message: 'tool worker crashed',
        },
      },
    ];

    renderApp();
    await typeAndSend('do something');
    await waitFor(() =>
      expect(screen.getByRole('log').textContent).toContain('E_TOOL_PANIC: tool worker crashed'),
    );
  }, 20_000);
});

// 抑制 jsdom 下 AudioContext/Notification 相关噪音。
vi.stubGlobal('AudioContext', class {
  createOscillator() {
    return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } };
  }
  createGain() {
    return { connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} } };
  }
  get destination() {
    return {};
  }
  get currentTime() {
    return 0;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  get state() {
    return 'running';
  }
});
