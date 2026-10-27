/**
 * Agent 桌面核心回路 —— chat → plan → edit 全链路 + goal 模式多轮续作。
 *
 * 本文件是套件中的"旗舰"场景测试：真实挂载应用，用户从 Composer 发起
 * （自由文本或 /plan、/goal 斜杠命令），ScriptedAgent 按真实 agent 行为
 * 回放事件流（plan 草稿多次更新 → plan_ready → 暂停等用户决策 → 批准后
 * 执行编辑工具（逐工具审批）→ 完成），断言完整 IPC 时序、线格式、
 * 转录内容与 store 状态。
 *
 * goal 模式（Op::EnterGoalMode / ExitGoalMode, v1.2 P1）：agent 进入目标
 * 模式后**无需用户再次提交**即自动续作多轮 turn —— 测试通过直接 emit
 * 验证 GUI 侧对"agent 驱动的多 turn"的正确呈现（多 turn 累积、状态流转）。
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
  const textarea = await screen.findByLabelText('Message Reflect');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

/** 当前消息流（log）节点。 */
function logText(): string {
  return screen.getByRole('log').textContent ?? '';
}

describe('chat → plan → edit full loop (real app mount)', () => {
  it('plans, waits for the user decision, then executes an edit tool and completes', async () => {
    // 完整编排:思考 → plan 草稿两次更新 → plan_ready → [gate:等用户决策]
    // → plan_approved → 编辑工具(write_file,需逐工具审批) → [gate] → 完成。
    backend.agent.script = [
      { emit: { type: 'thinking_delta', delta: 'designing the migration' } },
      {
        emit: {
          type: 'plan_draft_updated',
          draft_id: 'migration.md',
          markdown: '# Migration\ndraft v1',
        },
      },
      {
        emit: {
          type: 'plan_draft_updated',
          draft_id: 'migration.md',
          markdown: '# Migration\ndraft v2',
          path: '/tmp/plans/migration.md',
        },
      },
      {
        emit: {
          type: 'plan_ready',
          plan_id: 'plan-1',
          markdown: '# Migration plan\n- step 1: snapshot\n- step 2: apply',
        },
      },
      { gate: 'plan_approval', id: 'plan-1' },
      { emit: { type: 'plan_approved', plan_id: 'plan-1' } },
      { emit: { type: 'agent_message_delta', delta: 'Executing the plan.' } },
      {
        emit: {
          type: 'tool_call_begin',
          call_id: 'call-edit-1',
          tool_name: 'write_file',
          args: { path: 'src/migration.rs' },
        },
      },
      {
        emit: {
          type: 'approval_request',
          request_id: 'apr-edit',
          kind: { type: 'tool', tool_name: 'write_file', args: { path: 'src/migration.rs' } },
          risk: 'high',
        },
      },
      { gate: 'tool_approval', id: 'apr-edit' },
      {
        emit: {
          type: 'tool_call_end',
          call_id: 'call-edit-1',
          is_error: false,
          elapsed_ms: 80,
          output: {
            content: [{ type: 'text', text: 'wrote 42 lines to src/migration.rs' }],
            is_error: false,
            metadata: null,
            elapsed_ms: 80,
          },
        },
      },
      { emit: { type: 'agent_message_delta', delta: 'Migration applied.' } },
      {
        emit: [
          { type: 'turn_complete', turn_id: 't-1', usage: {}, status: 'success' },
          {
            type: 'token_count',
            input_tokens: 900,
            output_tokens: 300,
            cached_tokens: 0,
            cache_write_tokens: 0,
            total_tokens: 1200,
            cost_usd: 0.01,
            provider: 'anthropic',
            credential_label: 'main',
          },
        ],
      },
    ];

    renderApp();

    // 1. 用户自由文本发起。
    await typeAndSend('migrate the database to v2');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    expect(backend.agent.submissions[0].op).toEqual({
      type: 'user_input',
      items: [{ type: 'text', text: 'migrate the database to v2' }],
    });

    // 2. plan 就绪弹窗出现;agent 在 gate 暂停,尚未收到任何决策。
    const planTitle = await screen.findByText('Plan Ready');
    const dialog = planTitle.closest('[role="dialog"]') as HTMLDivElement;
    // plan_ready payload 无 summary/plan 字段 → 模态展示 JSON(含 plan_id 与正文)。
    expect(dialog.textContent).toContain('plan-1');
    expect(dialog.textContent).toContain('# Migration plan');
    expect(backend.agent.planChoices.length).toBe(0);

    // 3. 用户选 Auto Mode(主按钮)→ 线格式 choice='auto_mode'。
    fireEvent.click(within(dialog).getByText('Approve plan'));
    await waitFor(() => expect(backend.agent.planChoices.length).toBe(1));
    expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-1', choice: 'auto_mode' });

    // 4. gate 放行:plan_approved 事件到达,pendingPlan 清空,模态关闭。
    await waitFor(() => expect(useAgentStore.getState().pendingPlan).toBeNull());
    await waitFor(() => expect(screen.queryByText('Plan Ready')).toBeNull());
    await waitFor(() => expect(logText()).toContain('Executing the plan.'));

    // 5. 编辑工具需逐工具审批 —— 第二个模态。
    const toolTitle = await screen.findByText('Tool Approval');
    const toolDialog = toolTitle.closest('[role="dialog"]') as HTMLDivElement;
    expect(within(toolDialog).getByText('write_file')).toBeDefined();
    fireEvent.click(within(toolDialog).getByText('Approve'));
    await waitFor(() => expect(backend.agent.toolApprovals.length).toBe(1));
    expect(backend.agent.toolApprovals[0]).toEqual({ id: 'apr-edit', decision: 'approve' });

    // 6. 工具输出落 store(tool_output 折叠渲染),收尾文本进转录。
    await waitFor(() => {
      const turns = useAgentStore.getState().turns;
      const last = turns[turns.length - 1];
      const output = last.items.find((i) => i.kind === 'tool_output');
      expect(output && output.kind === 'tool_output' ? output.text : '').toContain(
        'wrote 42 lines',
      );
    });
    await waitFor(() => expect(logText()).toContain('Migration applied.'));

    // 7. 完成:token 统计、turn done、编排执行完毕。
    await waitFor(() => expect(useAgentStore.getState().tokens?.total).toBe(1200));
    await waitFor(() => expect(backend.agent.finished).toBe(true));
    const turns = useAgentStore.getState().turns;
    expect(turns[turns.length - 1].status).toBe('done');

    // 8. 完整 IPC 时序:submit → plan_approval → tool_approval。
    const seq = backend.calls
      .map((c) => c.cmd)
      .filter((c) => ['reflect_submit', 'reflect_plan_approval', 'reflect_tool_approval'].includes(c));
    expect(seq).toEqual(['reflect_submit', 'reflect_plan_approval', 'reflect_tool_approval']);
  }, 30_000);

  it('Manual Approve choice sends manual_approve and the edit flow still completes', async () => {
    backend.agent.script = [
      {
        emit: { type: 'plan_ready', plan_id: 'plan-2', markdown: '# Rollback plan' },
      },
      { gate: 'plan_approval', id: 'plan-2' },
      { emit: { type: 'plan_approved', plan_id: 'plan-2' } },
      { emit: { type: 'agent_message_delta', delta: 'Rollback done.' } },
      { emit: { type: 'turn_complete', turn_id: 't-2', usage: {}, status: 'success' } },
    ];

    renderApp();
    await typeAndSend('prepare a rollback');

    const planTitle = await screen.findByText('Plan Ready');
    const dialog = planTitle.closest('[role="dialog"]') as HTMLDivElement;
    fireEvent.click(within(dialog).getByText('Manual Approve'));

    await waitFor(() => expect(backend.agent.planChoices.length).toBe(1));
    expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-2', choice: 'manual_approve' });
    await waitFor(() => expect(useAgentStore.getState().pendingPlan).toBeNull());
    await waitFor(() => expect(logText()).toContain('Rollback done.'));
    await waitFor(() => expect(backend.agent.finished).toBe(true));
  }, 20_000);

  it('Reject sends revise; the agent re-plans and the modal is event-driven closed', async () => {
    backend.agent.script = [
      {
        emit: { type: 'plan_ready', plan_id: 'plan-3', markdown: '# First attempt' },
      },
      { gate: 'plan_approval', id: 'plan-3' },
      // 用户拒绝 → agent 留在 plan 模式,重新出草稿后再给一版。
      { emit: { type: 'plan_rejected', plan_id: 'plan-3', reason: 'revise requested' } },
      {
        emit: {
          type: 'plan_draft_updated',
          draft_id: 'retry.md',
          markdown: '# Revised draft',
        },
      },
      { emit: { type: 'agent_message_delta', delta: 'Please review the revised approach.' } },
      { emit: { type: 'turn_complete', turn_id: 't-3', usage: {}, status: 'success' } },
    ];

    renderApp();
    await typeAndSend('design the cache layer');

    const planTitle = await screen.findByText('Plan Ready');
    const dialog = planTitle.closest('[role="dialog"]') as HTMLDivElement;
    fireEvent.click(within(dialog).getByText('Reject'));

    await waitFor(() => expect(backend.agent.planChoices.length).toBe(1));
    expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-3', choice: 'revise' });

    // plan_rejected 事件驱动关闭;agent 继续(重新出草稿 + 提示语)。
    await waitFor(() => expect(useAgentStore.getState().pendingPlan).toBeNull());
    await waitFor(() => expect(logText()).toContain('Please review the revised approach.'));
    await waitFor(() => expect(backend.agent.finished).toBe(true));
    const turns = useAgentStore.getState().turns;
    expect(turns[turns.length - 1].status).toBe('done');
  }, 20_000);

  it('/plan slash enters plan mode with the task on the wire, then the full loop runs', async () => {
    renderApp();
    await typeAndSend('/plan migrate the database');

    // 斜杠走 Op 命令(Op::EnterPlanMode)而非用户文本提交 ——
    // ScriptedAgent 的脚本只绑定 reflect_submit,Op 驱动的事件流在此手动 emit
    // (id 用 enter_plan_mode 返回的 submission id,真实语义一致)。
    await waitFor(() => expect(backend.callsOf('reflect_enter_plan_mode').length).toBe(1));
    expect(backend.lastArgsOf('reflect_enter_plan_mode')).toEqual({
      task: 'migrate the database',
    });
    expect(backend.agent.submissions.length).toBe(0);
    const subId = 'plan-mode-sub';

    // agent 在 plan 模式下产出计划,经 plan_ready 推送给用户决策。
    emitEvent(subId, { type: 'plan_ready', plan_id: 'plan-4', markdown: '# From slash' });
    const planTitle = await screen.findByText('Plan Ready');
    const dialog = planTitle.closest('[role="dialog"]') as HTMLDivElement;
    fireEvent.click(within(dialog).getByText('Approve plan'));
    await waitFor(() => expect(backend.agent.planChoices.length).toBe(1));
    expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-4', choice: 'auto_mode' });

    // 批准后 agent 在同一 submission id 下继续执行并收尾。
    emitEvent(subId, { type: 'plan_approved', plan_id: 'plan-4' });
    emitEvent(subId, { type: 'agent_message_delta', delta: 'Plan from slash approved.' });
    emitEvent(subId, { type: 'turn_complete', turn_id: subId, usage: {}, status: 'success' });
    await waitFor(() => expect(logText()).toContain('Plan from slash approved.'));
    const turns = useAgentStore.getState().turns;
    expect(turns[turns.length - 1].status).toBe('done');
  }, 20_000);

  it('/exit-plan leaves plan mode via the dedicated Op command', async () => {
    renderApp();
    await typeAndSend('/exit-plan');

    await waitFor(() => expect(backend.callsOf('reflect_exit_plan_mode').length).toBe(1));
    expect(backend.agent.submissions.length).toBe(0);
    // 不产生转录内容(纯模式切换,无 agent 回复)。
    await new Promise((r) => setTimeout(r, 50));
    expect(logText()).not.toContain('/exit-plan');
  }, 10_000);
});

describe('goal mode (/goal = 开目标会话 + 自动续作)', () => {
  it('/goal <text> creates a session, arms the verifier and starts the loop with the goal as the first message', async () => {
    renderApp();

    // 1. 用户经斜杠设定目标 —— 新契约:先建会话并切换(首页无会话时)。
    await typeAndSend('/goal make all tests pass');
    await waitFor(() => expect(backend.callsOf('reflect_create_session').length).toBe(1));
    await waitFor(() => expect(backend.callsOf('reflect_enter_goal_mode').length).toBe(1));
    expect(backend.lastArgsOf('reflect_enter_goal_mode')).toMatchObject({
      goal: 'make all tests pass',
    });
    // fake 后端镜像 core 行为:GoalController 挂入 cfg.goal。
    expect(backend.state.goal).toEqual({
      active: true,
      goal: 'make all tests pass',
      verifyCommand: null,
      tokenBudget: null,
      // v1.7 快照口径新增字段(reflect_goal_snapshot 消费)。
      turnCount: 0,
      tokensUsed: 0,
    });

    // 2. 首条消息 = 目标文本,作为普通 user_input 提交(启动循环的一轮)。
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    expect(backend.agent.submissions[0].op).toEqual({
      type: 'user_input',
      items: [{ type: 'text', text: 'make all tests pass' }],
    });
    // 转录里能看到目标文本(乐观 user turn 已渲染)。
    await waitFor(() => expect(logText()).toContain('make all tests pass'));

    // 3. 完成首轮(submission id 即乐观 turn id),再跑一轮 agent 自续作:
    //    每轮 turn 结束由 controller 自校验,未完成则 steering 续作 ——
    //    对用户**无新提交**。
    const firstTurnId = backend.agent.submissions[0].id;
    emitEvent(firstTurnId, { type: 'turn_started', turn_id: firstTurnId });
    emitEvent(firstTurnId, {
      type: 'agent_message_delta',
      delta: 'Round 1: fixing test A',
    });
    emitEvent(firstTurnId, {
      type: 'turn_complete',
      turn_id: firstTurnId,
      usage: {},
      status: 'success',
    });

    emitEvent('goal-t2', { type: 'turn_started', turn_id: 'goal-t2' });
    emitEvent('goal-t2', {
      type: 'tool_call_begin',
      call_id: 'call-goal-edit',
      tool_name: 'edit_file',
      args: { path: 'src/lib.rs' },
    });
    emitEvent('goal-t2', {
      type: 'tool_call_end',
      call_id: 'call-goal-edit',
      is_error: false,
      elapsed_ms: 12,
      output: {
        content: [{ type: 'text', text: 'patched src/lib.rs' }],
        is_error: false,
        metadata: null,
        elapsed_ms: 12,
      },
    });
    emitEvent('goal-t2', { type: 'agent_message_delta', delta: 'Round 2: all tests pass now' });
    emitEvent('goal-t2', { type: 'turn_complete', turn_id: 'goal-t2', usage: {}, status: 'success' });
    emitEvent('goal-t2', {
      type: 'token_count',
      input_tokens: 400,
      output_tokens: 200,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 600,
    });

    // 4. GUI 正确呈现:首轮 + 续作轮都 done,转录含两轮内容,🎯 徽标亮起。
    await waitFor(() => {
      const turns = useAgentStore.getState().turns;
      expect(turns.length).toBe(2);
      expect(turns[0].status).toBe('done');
      expect(turns[1].status).toBe('done');
    });
    await waitFor(() => expect(logText()).toContain('Round 1: fixing test A'));
    await waitFor(() => expect(logText()).toContain('Round 2: all tests pass now'));
    expect(useAgentStore.getState().tokens?.total).toBe(600);
    expect(useAgentStore.getState().goalActive).toBe(true);

    // 5. 续作全程零新增用户提交 —— 目标模式区别于普通聊天的关键可观察行为。
    expect(backend.agent.submissions.length).toBe(1);
    expect(backend.callsOf('reflect_submit').length).toBe(1);
    // 目标模式仍激活。
    expect(backend.state.goal.active).toBe(true);
  }, 20_000);

  it('/goal clear exits goal mode (Op::ExitGoalMode) and stops auto-continuation', async () => {
    renderApp();

    await typeAndSend('/goal make all tests pass');
    await waitFor(() => expect(backend.state.goal.active).toBe(true));

    // agent 自校验中 —— 此时用户叫停。
    const firstTurnId = backend.agent.submissions[0].id;
    emitEvent(firstTurnId, { type: 'turn_started', turn_id: firstTurnId });
    emitEvent(firstTurnId, { type: 'agent_message_delta', delta: 'working on it' });
    await waitFor(() => expect(logText()).toContain('working on it'));

    await typeAndSend('/goal clear');
    await waitFor(() => expect(backend.callsOf('reflect_exit_goal_mode').length).toBe(1));
    expect(backend.state.goal).toEqual({
      active: false,
      goal: null,
      verifyCommand: null,
      tokenBudget: null,
      turnCount: 0,
      tokensUsed: 0,
    });
    await waitFor(() => expect(useAgentStore.getState().goalActive).toBe(false));
  }, 20_000);
});

// 抑制 jsdom 下 AudioContext 相关噪音(与 chat.full-flow 保持一致)。
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
