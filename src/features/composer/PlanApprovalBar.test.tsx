/**
 * Vitest — PlanApprovalBar（输入框上方的计划审批条）。
 *
 * 计划审批不再走全局弹窗；本条承接两个轻决策：
 * 1. plan_ready → 同意执行计划（auto_mode）/ 逐项确认（manual_approve）/
 *    查看计划（打开右 dock 计划页签）；审批条保持到事件清 pendingPlan。
 * 2. plan_request → 进入计划模式（manual_approve）/ 暂不进入（revise）；
 *    会话已在计划模式时不渲染（usePlanSurfacing 静默应答）。
 */
/**
 * Vitest — PlanApprovalBar（输入框上方的计划审批条）。
 *
 * 计划审批不再走全局弹窗；本条承接两个轻决策：
 * 1. plan_ready → 同意执行计划（auto_mode）/ 逐项确认（manual_approve）/
 *    查看计划（打开右 dock 计划页签）；审批条保持到事件清 pendingPlan。
 * 2. plan_request → 进入计划模式（manual_approve）/ 暂不进入（revise）；
 *    会话已在计划模式时不渲染（usePlanSurfacing 静默应答）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import { useAgentStore, type PendingPlan } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { PlanApprovalBar } from './PlanApprovalBar';

function renderBar() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider><PlanApprovalBar /></I18nProvider>
    </QueryClientProvider>,
  );
}

function plan(partial: Partial<PendingPlan>): PendingPlan {
  return { id: 'p1', kind: 'ready', payload: {}, turnId: 't1', ...partial };
}

/** 捕获 zhuye_plan_approval 的 wire 决策（id + choice）。 */
function capturePlanApproval(): Array<{ id: string; choice: string }> {
  const calls: Array<{ id: string; choice: string }> = [];
  mockInvoke('zhuye_plan_approval', async (_cmd: string, args: { id: string; choice: string }) => {
    calls.push(args);
    return 'sub-1';
  });
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  // 断言锚定中文文案。
  localStorage.setItem('zhuye.locale', 'zh-CN');
  resetMockInvoke();
  useAgentStore.getState().reset();
  useShellUi.setState({ dockOpen: false, dockTabs: [], dockActiveId: null });
});

describe('PlanApprovalBar', () => {
  it('无挂起计划时不渲染', () => {
    renderBar();
    expect(screen.queryByTestId('composer-plan-bar')).toBeNull();
  });

  it('计划就绪：同意执行发 auto_mode，逐项确认发 manual_approve', async () => {
    const calls = capturePlanApproval();
    useAgentStore.setState({ pendingPlan: plan({ id: 'plan-1' }) });
    renderBar();

    fireEvent.click(screen.getByTestId('plan-bar-approve'));
    await waitFor(() => expect(calls).toEqual([{ id: 'plan-1', choice: 'auto_mode' }]));

    fireEvent.click(screen.getByTestId('plan-bar-manual'));
    await waitFor(() =>
      expect(calls[1]).toEqual({ id: 'plan-1', choice: 'manual_approve' }),
    );
  });

  it('查看计划：打开右 dock 的计划标签页', () => {
    capturePlanApproval();
    useAgentStore.setState({ pendingPlan: plan({ id: 'plan-1' }) });
    renderBar();

    fireEvent.click(screen.getByTestId('plan-bar-view'));
    const ui = useShellUi.getState();
    expect(ui.dockOpen).toBe(true);
    expect(ui.dockTabs.some((tab) => tab.kind === 'plan')).toBe(true);
    expect(ui.dockActiveId).toBe('plan');
  });

  it('请求进入计划模式：进入发 manual_approve，暂不进入发 revise', async () => {
    const calls = capturePlanApproval();
    useAgentStore.setState({ pendingPlan: plan({ id: 'req-1', kind: 'request', payload: { task: '调研迁移' } }) });
    renderBar();
    expect(screen.getByTestId('composer-plan-bar').textContent).toContain('调研迁移');

    fireEvent.click(screen.getByTestId('plan-bar-decline'));
    await waitFor(() => expect(calls).toEqual([{ id: 'req-1', choice: 'revise' }]));
    // request 的本地清挂起是 approvePlan await 之后的动作 —— 等审批条
    // 真正卸载再摆下一条，避免清空写覆盖新挂起。
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());

    useAgentStore.setState({ pendingPlan: plan({ id: 'req-2', kind: 'request', payload: { task: '调研迁移' } }) });
    await screen.findByTestId('composer-plan-bar');
    fireEvent.click(screen.getByTestId('plan-bar-enter'));
    await waitFor(() => expect(calls[1]).toEqual({ id: 'req-2', choice: 'manual_approve' }));
  });

  it('已在计划模式下的 request 不渲染（冗余 enter 由 usePlanSurfacing 静默应答）', () => {
    capturePlanApproval();
    useAgentStore.setState({
      permissionMode: 'plan',
      pendingPlan: plan({ id: 'req-3', kind: 'request', payload: { task: 'x' } }),
    });
    renderBar();
    expect(screen.queryByTestId('composer-plan-bar')).toBeNull();
  });

  it('事件清 pendingPlan 后审批条消失', async () => {
    capturePlanApproval();
    useAgentStore.setState({ pendingPlan: plan({ id: 'plan-2' }) });
    renderBar();
    expect(screen.getByTestId('composer-plan-bar')).toBeDefined();
    useAgentStore.setState({ pendingPlan: null });
    await waitFor(() => expect(screen.queryByTestId('composer-plan-bar')).toBeNull());
  });
});
