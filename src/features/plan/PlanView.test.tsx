/**
 * PlanView —— plan 执行进度渲染测试。
 *
 * 验证：
 *   - 无 plan、无进度 → 空状态
 *   - 有 `plan_step` 进度 → 渲染 step 清单(标题 + 状态徽标)
 *   - 待审批 plan 存在时 → 审批按钮区照旧
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PlanView } from '@/features/plan/PlanView';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke } from '@/test/setup.tsx';
import type { PlanStepState } from '@/stores/agent/types';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

function setSteps(steps: PlanStepState[]) {
  useAgentStore.setState({ planSteps: steps });
}

describe('PlanView —— plan 执行进度', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('无 plan 且无进度 → 空状态', () => {
    render(<PlanView />);
    expect(screen.queryByTestId('plan-steps')).toBeNull();
  });

  it('渲染 step 清单:标题 + 状态徽标', () => {
    setSteps([
      { index: 0, total: 2, status: 'done', title: '读代码', planId: 'p1' },
      { index: 1, total: 2, status: 'in_progress', title: '改代码', planId: 'p1' },
    ]);
    render(<PlanView />);

    const panel = screen.getByTestId('plan-steps');
    expect(panel.textContent).toContain('读代码');
    expect(panel.textContent).toContain('改代码');
    expect(panel.textContent).toContain('done');
    expect(panel.textContent).toContain('in_progress');
  });

  it('step 没有标题时用状态文案兜底', () => {
    setSteps([{ index: 0, total: 1, status: 'pending', title: null, planId: 'p1' }]);
    render(<PlanView />);
    const panel = screen.getByTestId('plan-steps');
    expect(panel.textContent).toContain('pending');
  });

  it('待审批 plan 存在时审批入口照旧', () => {
    useAgentStore.setState({
      pendingPlan: {
        id: 'p1',
        turnId: 't1',
        payload: { task: '做一件事', plan: '## Plan\n- 步骤一' },
      },
    } as never);
    render(<PlanView />);
    expect(screen.getByText('做一件事')).toBeDefined();
  });
});
