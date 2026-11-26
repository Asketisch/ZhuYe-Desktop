/**
 * 挂起交互全路径 —— ApprovalModal / QuestionModal / AskUserModal / PlanApprovalBar。
 *
 * 真实 ModalStack 挂载 + 事件注入驱动 pending 状态 + 用户点击 →
 * 断言 wire 上的决策形状（ReviewDecision / PlanApprovalChoice / answers）
 * 与关闭时序。这是"agent 暂停 → 用户决策 → 回执"回路的 UI 侧锁定。
 * 计划审批不走全局弹窗：PlanApprovalBar（composer 审批条）替代 PlanReadyModal。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderView } from './helpers/appHarness';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { ModalStack } from '@/features/harness/modals';
import { PlanApprovalBar } from '@/features/input/composer/PlanApprovalBar';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;
let unsub: (() => void) | null = null;

beforeEach(() => {
  backend = installFakeBackend();
  useAgentStore.getState().reset();
  unsub = useAgentStore.getState().subscribe();
  renderView(<ModalStack />);
});

afterEach(() => {
  unsub?.();
  unsub = null;
});

const TURN = 'sub-modal';

function requestToolApproval(id = 'apr-1', tool = 'bash') {
  emitEvent(TURN, {
    type: 'approval_request',
    request_id: id,
    kind: { type: 'tool', tool_name: tool, args: { cmd: 'ls -la' } },
    risk: 'low',
  });
}

describe('ApprovalModal', () => {
  it('Approve sends ReviewDecision "approve" and closes', async () => {
    requestToolApproval();
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;

    fireEvent.click(within(dialog).getByText('Approve'));
    await waitFor(() => expect(backend.agent.toolApprovals).toEqual([
      { id: 'apr-1', decision: 'approve' },
    ]));
    await waitFor(() => expect(screen.queryByText('Tool Approval')).toBeNull());
  });

  it('Approve for session sends "approve_for_session"', async () => {
    requestToolApproval('apr-2');
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;

    fireEvent.click(within(dialog).getByText('Approve for session'));
    await waitFor(() =>
      expect(backend.agent.toolApprovals[0]).toEqual({ id: 'apr-2', decision: 'approve_for_session' }),
    );
  });

  it('Deny sends { deny: { reason } } wire form', async () => {
    requestToolApproval('apr-3');
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;

    fireEvent.click(within(dialog).getByText('Deny'));
    await waitFor(() =>
      expect(backend.agent.toolApprovals[0]).toEqual({
        id: 'apr-3',
        decision: { deny: { reason: 'denied by user' } },
      }),
    );
  });

  it('hook approvals route to zhuye_hook_approval', async () => {
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'hk-apr',
      kind: { type: 'hook', hook_name: 'fmt-on-save', decision_preview: 'rustfmt src/lib.rs' },
    });
    const title = await screen.findByText('Hook Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;

    fireEvent.click(within(dialog).getByText('Approve'));
    await waitFor(() =>
      expect(backend.agent.hookApprovals).toEqual([{ id: 'hk-apr', decision: 'approve' }]),
    );
    expect(backend.agent.toolApprovals.length).toBe(0);
  });

  it('multiple approvals queue as separate modals', async () => {
    requestToolApproval('apr-a', 'read_file');
    requestToolApproval('apr-b', 'write_file');
    await waitFor(() => expect(screen.getAllByText('Tool Approval').length).toBe(2));
    expect(screen.getByText('read_file')).toBeDefined();
    expect(screen.getByText('write_file')).toBeDefined();
  });
});

describe('QuestionModal', () => {
  function askQuestion() {
    emitEvent(TURN, {
      type: 'ask_user_question',
      request_id: 'q-modal',
      questions: [
        {
          header: 'Database',
          question: 'Which database?',
          multi_select: false,
          options: [{ label: 'Postgres', description: 'relational' }, { label: 'Mongo', description: 'document' }],
        },
        {
          header: 'Features',
          question: 'Which features?',
          multi_select: true,
          options: [{ label: 'Auth', description: '' }, { label: 'Audit', description: '' }, { label: 'Cache', description: '' }],
        },
      ],
    });
  }

  it('renders protocol selection modes and submits selected indices and custom text', async () => {
    askQuestion();
    await screen.findByText('Which database?');
    expect(screen.getByRole('radio', { name: /Postgres/ })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: /Auth/ })).toBeDefined();

    // 第一题：单选 Postgres（radio）。
    fireEvent.click(screen.getByLabelText(/Postgres/));
    // 第二题：多选 Auth + Cache（checkbox）。
    fireEvent.click(screen.getByLabelText(/Auth/));
    fireEvent.click(screen.getByLabelText(/Cache/));
    fireEvent.change(screen.getByLabelText(/Other.*Which features/), { target: { value: '  Metrics  ' } });

    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(backend.agent.questionResponses).toEqual([
        { id: 'q-modal', answers: { answers: [{ selected: [0] }, { selected: [0, 2], custom: 'Metrics' }] } },
      ]),
    );
    await waitFor(() => expect(screen.queryByText('Which database?')).toBeNull());
  });

  it('submit 未全部作答不渲染(选选项或填自定义任一算已答),答完才出现', async () => {
    askQuestion();
    await screen.findByText('Which database?');
    // 未作答 → 不渲染提交按钮(显式跳过走 Esc 关闭,见下例)。
    expect(screen.queryByText('Submit')).toBeNull();
    expect(backend.agent.questionResponses).toEqual([]);

    // 第二题填自定义文本也算已答,但第一题未答仍不显示。
    fireEvent.click(screen.getByLabelText(/Auth/));
    expect(screen.queryByText('Submit')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Other.*Which features/), { target: { value: 'Metrics' } });
    expect(screen.queryByText('Submit')).toBeNull();
    // 第一题也作答后提交出现,点击可正常回执。
    fireEvent.click(screen.getByLabelText(/Postgres/));
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(backend.agent.questionResponses).toEqual([
        { id: 'q-modal', answers: { answers: [{ selected: [0] }, { selected: [0], custom: 'Metrics' }] } },
      ]),
    );
  });

  it('closing sends a cancelled answer for each question', async () => {
    askQuestion();
    await screen.findByText('Which database?');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(backend.agent.questionResponses[0]).toEqual({
        id: 'q-modal',
        answers: { answers: [{ selected: [] }, { selected: [] }] },
      }),
    );
  });
});

describe('AskUserModal', () => {
  function askInput() {
    emitEvent(TURN, {
      type: 'ask_user_input',
      request_id: 'in-modal',
      prompt: 'Name the release branch:',
      placeholder: 'release/v2',
    });
  }

  it('typed text is sent as the response', async () => {
    askInput();
    await screen.findByText('Name the release branch:');
    const textarea = screen.getByPlaceholderText('release/v2') as HTMLTextAreaElement;
    // 空文本时 Submit 置灰(显式跳过走关闭)。
    expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'release/v2.1' } });
    expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() =>
      expect(backend.agent.inputResponses).toEqual([{ id: 'in-modal', text: 'release/v2.1' }]),
    );
    await waitFor(() => expect(screen.queryByText('Name the release branch:')).toBeNull());
  });

  it('closing submits empty string', async () => {
    askInput();
    await screen.findByText('Name the release branch:');
    // ModalShell 关闭按钮（aria-label Close）。
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() =>
      expect(backend.agent.inputResponses).toEqual([{ id: 'in-modal', text: '' }]),
    );
  });

  it('masks secret input and sends the entered value', async () => {
    emitEvent(TURN, {
      type: 'ask_user_input',
      request_id: 'secret-modal',
      prompt: 'Enter the secret:',
      secret: true,
      placeholder: 'Secret value',
    });
    const input = await screen.findByLabelText('Enter the secret:') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'private-value' } });
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(backend.agent.inputResponses).toEqual([{ id: 'secret-modal', text: 'private-value' }]),
    );
  });

  it('closes an input modal when its tool completes via an external answer', async () => {
    emitEvent(TURN, {
      type: 'tool_call_begin',
      call_id: 'human-tool',
      tool_name: 'request_human_input',
      args: { prompt: 'External answer?' },
    });
    emitEvent(TURN, {
      type: 'ask_user_input',
      request_id: 'external-answer',
      prompt: 'External answer?',
    });
    await screen.findByText('External answer?');
    // 外部回执(文件投递等)不经本地弹窗提交动作 —— 引擎统一走
    // resolve_pending 广播 interaction_resolved,前端据此按 request_id
    // 精确移除挂起态(tool_call_end 不再按 turnId 连坐清空,避免误删
    // 同回合其他 agent 的挂起交互)。
    emitEvent(TURN, {
      type: 'interaction_resolved',
      request_id: 'external-answer',
      kind: { type: 'ask_user' },
      outcome: 'answered',
    });
    await waitFor(() => expect(screen.queryByText('External answer?')).toBeNull());
    expect(backend.agent.inputResponses).toEqual([]);
  });

  it('closes only the interrupted turn’s pending input', async () => {
    askInput();
    emitEvent('other-turn', {
      type: 'ask_user_input',
      request_id: 'other-input',
      prompt: 'Other turn input',
    });
    await screen.findByText('Name the release branch:');
    emitEvent(TURN, { type: 'turn_aborted', turn_id: TURN, reason: { type: 'user_interrupt' } });
    await waitFor(() => expect(screen.queryByText('Name the release branch:')).toBeNull());
    expect(screen.getByText('Other turn input')).toBeDefined();
  });
});

describe('PlanApprovalBar（计划审批不再走全局弹窗，改 composer 审批条）', () => {
  function stagePlan() {
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-modal',
      markdown: '# Migration\n1. backup\n2. switch',
    });
  }

  it('Approve plan sends auto_mode choice and stays until plan_approved arrives', async () => {
    stagePlan();
    renderView(<PlanApprovalBar />);
    await screen.findByTestId('composer-plan-bar');
    // 全局模态栈不再承载计划（见下方 coexistence 用例）。

    fireEvent.click(screen.getByTestId('plan-bar-approve'));
    await waitFor(() =>
      expect(backend.agent.planChoices).toEqual([{ id: 'plan-modal', choice: 'auto_mode' }]),
    );
    // 关闭是事件驱动：后端确认 plan_approved（经 permission_mode_changed /
    // plan_approved 事件清 pendingPlan）后审批条才消失。
    expect(screen.getByTestId('composer-plan-bar')).toBeDefined();
    emitEvent(TURN, { type: 'plan_approved', plan_id: 'plan-modal' });
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());
  });

  it('approves a plan-mode request using its plan id and closes the request', async () => {
    renderView(<PlanApprovalBar />);
    emitEvent(TURN, { type: 'plan_request', plan_id: 'request-plan-id', task: 'Investigate the migration' });
    await screen.findByTestId('composer-plan-bar');
    fireEvent.click(screen.getByTestId('plan-bar-enter'));
    await waitFor(() => expect(backend.agent.planChoices).toEqual([
      { id: 'request-plan-id', choice: 'manual_approve' },
    ]));
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());
  });

  it('declines a plan-mode request using revise and closes it', async () => {
    renderView(<PlanApprovalBar />);
    emitEvent(TURN, { type: 'plan_request', plan_id: 'request-plan-id', task: 'Investigate the migration' });
    await screen.findByTestId('composer-plan-bar');
    fireEvent.click(screen.getByTestId('plan-bar-decline'));
    await waitFor(() => expect(backend.agent.planChoices).toEqual([
      { id: 'request-plan-id', choice: 'revise' },
    ]));
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());
  });

  it('Step-by-step approval sends manual_approve; revise stays until event clears', async () => {
    stagePlan();
    renderView(<PlanApprovalBar />);
    await screen.findByTestId('composer-plan-bar');
    fireEvent.click(screen.getByTestId('plan-bar-manual'));
    await waitFor(() =>
      expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-modal', choice: 'manual_approve' }),
    );

    stagePlan();
    fireEvent.click(screen.getByTestId('plan-bar-approve'));
    await waitFor(() =>
      expect(backend.agent.planChoices[1]).toEqual({ id: 'plan-modal', choice: 'auto_mode' }),
    );
    // revise 也在审批条上可直接触达（打回修订）。
    stagePlan();
    emitEvent(TURN, { type: 'plan_rejected', plan_id: 'plan-modal', reason: 'x' });
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());
  });
});

describe('modal coexistence', () => {
  it('三种打断型模态可同时挂起并独立解决；计划挂起不进模态栈', async () => {
    requestToolApproval('apr-x', 'bash');
    emitEvent(TURN, {
      type: 'ask_user_question',
      request_id: 'q-x',
      questions: [{ question: 'Ok to proceed?', options: [{ label: 'Yes' }] }],
    });
    emitEvent(TURN, { type: 'ask_user_input', request_id: 'in-x', prompt: 'Notes?' });
    emitEvent(TURN, { type: 'plan_ready', plan_id: 'plan-x', markdown: '# P' });

    await screen.findByText('Tool Approval');
    await screen.findByText('Ok to proceed?');
    await screen.findByText('Notes?');
    // 计划挂起不再产出任何 modal。
    expect(screen.queryByText('Plan ready')).toBeNull();

    // 只解决审批，其余两个仍打开。
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.queryByText('Tool Approval')).toBeNull());
    expect(screen.getByText('Ok to proceed?')).toBeDefined();
    expect(screen.getByText('Notes?')).toBeDefined();
    // pendingPlan 仍在 store，等 composer 审批条 / 右侧 dock 消费。
    expect(useAgentStore.getState().pendingPlan?.id).toBe('plan-x');
  });
});

describe('ApprovalModal — F06/F50 增强', () => {
  it('Never-again button sends { reject_for_session } wire form', async () => {
    requestToolApproval('apr-f06');
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;

    fireEvent.click(within(dialog).getByTestId('approval-never-again'));
    await waitFor(() =>
      expect(backend.agent.toolApprovals[0]).toEqual({
        id: 'apr-f06',
        decision: {
          reject_for_session: {
            reason: 'denied by user (never ask again this session)',
          },
        },
      }),
    );
    await waitFor(() => expect(screen.queryByText('Tool Approval')).toBeNull());
  });

  it('risk badge renders when risk level present', async () => {
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-risk',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'ls' } },
      risk: 'high',
    });
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role="dialog"]') ?? document.body;
    expect(
      within(dialog).getByTestId('approval-risk-high').textContent,
    ).toContain('high');
  });
});
