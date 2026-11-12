/**
 * 模态交互全路径 —— ApprovalModal / QuestionModal / AskUserModal / PlanReadyModal。
 *
 * 真实 ModalStack 挂载 + 事件注入驱动 pending 状态 + 用户点击 →
 * 断言 wire 上的决策形状（ReviewDecision / PlanApprovalChoice / answers）
 * 与模态关闭时序。这是"agent 暂停 → 用户决策 → 回执"回路的 UI 侧锁定。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderView } from './helpers/appHarness';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { ModalStack } from '@/features/modals';
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

  it('hook approvals route to reflect_hook_approval', async () => {
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

  it('submitting without selection sends an empty answer for each question', async () => {
    askQuestion();
    await screen.findByText('Which database?');
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(backend.agent.questionResponses[0]).toEqual({
        id: 'q-modal',
        answers: { answers: [{ selected: [] }, { selected: [] }] },
      }),
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

    fireEvent.change(textarea, { target: { value: 'release/v2.1' } });
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
    emitEvent(TURN, {
      type: 'tool_call_end',
      call_id: 'human-tool',
      output: { content: [{ type: 'text', text: 'file-answer' }], is_error: false, metadata: {}, elapsed_ms: 1 },
      is_error: false,
      elapsed_ms: 1,
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

describe('PlanReadyModal', () => {
  function stagePlan() {
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-modal',
      markdown: '# Migration\n1. backup\n2. switch',
    });
  }

  it('Approve plan sends auto_mode choice', async () => {
    stagePlan();
    await screen.findByText('Plan Ready');
    expect(screen.getByText((_, element) =>
      element?.tagName === 'PRE' && element.textContent === '# Migration\n1. backup\n2. switch',
    )).toBeDefined();

    fireEvent.click(screen.getByText('Approve plan'));
    await waitFor(() =>
      expect(backend.agent.planChoices).toEqual([{ id: 'plan-modal', choice: 'auto_mode' }]),
    );
    // 关闭是事件驱动：后端确认 plan_approved 后 modal 才消失。
    emitEvent(TURN, { type: 'plan_approved', plan_id: 'plan-modal' });
    await waitFor(() => expect(screen.queryByText('Plan Ready')).toBeNull());
  });

  it('approves a plan-mode request using its plan id and closes the request', async () => {
    emitEvent(TURN, { type: 'plan_request', plan_id: 'request-plan-id', task: 'Investigate the migration' });
    await screen.findByText('Investigate the migration');
    fireEvent.click(screen.getByText('Enter plan mode'));
    await waitFor(() => expect(backend.agent.planChoices).toEqual([
      { id: 'request-plan-id', choice: 'manual_approve' },
    ]));
    await waitFor(() => expect(screen.queryByText('Investigate the migration')).toBeNull());
  });

  it('declines a plan-mode request using revise and closes it', async () => {
    emitEvent(TURN, { type: 'plan_request', plan_id: 'request-plan-id', task: 'Investigate the migration' });
    await screen.findByText('Investigate the migration');
    fireEvent.click(screen.getByText('Not now'));
    await waitFor(() => expect(backend.agent.planChoices).toEqual([
      { id: 'request-plan-id', choice: 'revise' },
    ]));
    await waitFor(() => expect(screen.queryByText('Investigate the migration')).toBeNull());
  });

  it('Manual Approve sends manual_approve', async () => {
    stagePlan();
    await screen.findByText('Manual Approve');
    fireEvent.click(screen.getByText('Manual Approve'));
    await waitFor(() =>
      expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-modal', choice: 'manual_approve' }),
    );
  });

  it('Revise sends revise', async () => {
    stagePlan();
    await screen.findByText('Plan Ready');
    fireEvent.click(screen.getByText('Revise'));
    await waitFor(() =>
      expect(backend.agent.planChoices[0]).toEqual({ id: 'plan-modal', choice: 'revise' }),
    );
  });

  it('plan_approved event from backend clears the modal without extra IPC', async () => {
    stagePlan();
    await screen.findByText('Plan Ready');
    emitEvent(TURN, { type: 'plan_approved', plan_id: 'plan-modal' });
    await waitFor(() => expect(screen.queryByText('Plan Ready')).toBeNull());
    expect(backend.agent.planChoices.length).toBe(0);
  });
});

describe('modal coexistence', () => {
  it('all four modal kinds can be pending simultaneously and resolve independently', async () => {
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
    await screen.findByText('Plan Ready');

    // 只解决审批，其余三个仍打开。
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.queryByText('Tool Approval')).toBeNull());
    expect(screen.getByText('Ok to proceed?')).toBeDefined();
    expect(screen.getByText('Notes?')).toBeDefined();
    expect(screen.getByText('Plan Ready')).toBeDefined();
  });
});
