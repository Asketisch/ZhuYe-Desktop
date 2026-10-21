/**
 * Vitest — ModalStack(阶段 3c):接通 store 的 pending 队列。
 *
 * 验证:
 * 1. 无 pending 时不渲染任何 modal
 * 2. ApprovalModal 从 pendingApprovals 渲染,点击 Approve 调 store action
 * 3. AskUserModal 提交文本调 answerInput
 * 4. PlanReadyModal 从 pendingPlan 渲染
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ModalStack } from '@/features/modals';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';
import { I18nProvider } from '@/utils/i18n';

function wrap(node: React.ReactNode) {
  return (
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>
    </I18nProvider>
  );
}

describe('ModalStack', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    resetMockInvoke();
  });
  afterEach(() => cleanup());

  it('renders nothing when no pending state', () => {
    render(wrap(<ModalStack />));
    // 没有 modal title 出现。
    expect(screen.queryByText('Tool Approval')).toBeNull();
    expect(screen.queryByText('Plan Ready')).toBeNull();
  });

  it('renders ApprovalModal from pendingApprovals and clears on Approve', async () => {
    mockInvoke('reflect_tool_approval', async () => 'sub-1');
    useAgentStore.setState({
      pendingApprovals: [
        { id: 'a1', kind: 'tool', toolName: 'bash', argsSummary: 'rm -rf /', turnId: 't1' },
      ],
    });
    render(wrap(<ModalStack />));
    expect(screen.getByText('Tool Approval')).toBeDefined();
    expect(screen.getByText('bash')).toBeDefined();

    // 点 Approve(primary)。
    fireEvent.click(screen.getByText('Approve'));
    // store action 乐观移除该 pending。
    expect(useAgentStore.getState().pendingApprovals.length).toBe(0);
  });

  it('renders AskUserModal and submits text', async () => {
    mockInvoke('reflect_ask_user_input_response', async () => 'sub-2');
    useAgentStore.setState({
      pendingAskUser: [{ id: 'u1', payload: { prompt: 'your name?' }, turnId: 't1' }],
    });
    render(wrap(<ModalStack />));
    expect(screen.getByText('your name?')).toBeDefined();

    const textarea = screen.getByPlaceholderText('Type here...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(useAgentStore.getState().pendingAskUser.length).toBe(0);
  });

  // —— 「始终允许这条命令」(写进核心的用户级权限文件)——

  it('Bash 审批出现「始终允许」入口,点击后写规则 + 批准', async () => {
    const addRule = vi.fn(async (_cmd: string, _args: unknown) => undefined);
    mockInvoke('reflect_add_permission_rule', addRule);
    mockInvoke('reflect_tool_approval', async () => 'sub-1');
    useAgentStore.setState({
      pendingApprovals: [
        {
          id: 'a1',
          kind: 'tool',
          toolName: 'bash',
          argsSummary: 'git status',
          args: { cmd: 'git status' },
          turnId: 't1',
        },
      ],
    });
    render(wrap(<ModalStack />));

    const btn = screen.getByTestId('approval-allow-always');
    expect(btn.textContent).toContain('git status');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(addRule).toHaveBeenCalledTimes(1);
    });
    expect(addRule.mock.calls[0][1]).toMatchObject({
      rule: {
        tool: 'Bash',
        action: 'allow',
        shellPattern: 'git status',
      },
    });
    // 写完规则即批准本次调用。
    await waitFor(() => {
      expect(useAgentStore.getState().pendingApprovals.length).toBe(0);
    });
  });

  it('写类工具审批不出现「始终允许」入口(核心规则模型没有路径维度)', () => {
    mockInvoke('reflect_tool_approval', async () => 'sub-1');
    useAgentStore.setState({
      pendingApprovals: [
        {
          id: 'a1',
          kind: 'tool',
          toolName: 'write',
          argsSummary: '{"path":"/tmp/a"}',
          args: { path: '/tmp/a' },
          turnId: 't1',
        },
      ],
    });
    render(wrap(<ModalStack />));
    expect(screen.queryByTestId('approval-allow-always')).toBeNull();
  });

  it('renders PlanReadyModal from pendingPlan', () => {    useAgentStore.setState({
      pendingPlan: { id: 'p1', payload: { summary: 'Step 1: do X' }, turnId: 't1' },
    });
    render(wrap(<ModalStack />));
    expect(screen.getByText('Plan Ready')).toBeDefined();
    expect(screen.getByText(/Step 1: do X/)).toBeDefined();
  });
});
