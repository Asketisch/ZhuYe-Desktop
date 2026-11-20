/**
 * CornerStack 组件测试 —— 右上角交互栈（任务清单 / 目标 / 子代理 / 建议）。
 *
 * 覆盖：todo 无清单隐藏 + 有清单徽标与条目渲染 + 折叠互切；goal 空闲
 * 表单进入目标模式（mock 命令）；子代理运行中徽标与中断按钮；建议卡
 * 点击预填 composer（mock prefill）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { CornerStack } from './CornerStack';

const { enterGoalMock, prefillMock } = vi.hoisted(() => ({
  enterGoalMock: vi.fn(async () => 'sub-1'),
  prefillMock: vi.fn(),
}));

vi.mock('@/utils/commands/goal', () => ({
  zhuye_enter_goal_mode: enterGoalMock,
  zhuye_exit_goal_mode: vi.fn(async () => 'sub-2'),
  zhuye_goal_snapshot: vi.fn(async () => null),
}));

vi.mock('@/features/composer/useComposerDraft', () => ({
  emitComposerPrefill: prefillMock,
}));

function renderStack() {
  return render(
    <I18nProvider>
      <CornerStack />
    </I18nProvider>,
  );
}

beforeEach(() => {
  enterGoalMock.mockClear();
  prefillMock.mockClear();
  useAgentStore.getState().reset();
});

describe('TodoWidget', () => {
  it('无清单时不渲染 todo widget', () => {
    renderStack();
    expect(screen.queryByTestId('corner-todo')).toBeNull();
  });

  it('有清单时默认展开，chip 显示完成徽标，条目逐条渲染', () => {
    useAgentStore.setState({
      todos: [
        { content: '任务甲', status: 'completed', active_form: null },
        { content: '任务乙', status: 'in_progress', active_form: '正在处理任务乙' },
        { content: '任务丙', status: 'pending', active_form: null },
      ],
    });
    renderStack();
    expect(screen.getByTestId('corner-todo')).toBeDefined();
    expect(screen.getByTestId('corner-todo-chip').textContent).toContain('1/3');
    expect(screen.getByTestId('corner-todo-panel').textContent).toContain('任务甲');
    expect(screen.getByTestId('corner-todo-active').textContent).toContain('正在处理任务乙');
  });

  it('点击 chip 可折叠再展开', () => {
    useAgentStore.setState({ todos: [{ content: '唯一任务', status: 'pending', active_form: null }] });
    renderStack();
    const chip = screen.getByTestId('corner-todo-chip');
    fireEvent.click(chip);
    expect(screen.queryByTestId('corner-todo-panel')).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByTestId('corner-todo-panel')).toBeDefined();
  });
});

describe('GoalWidget', () => {
  it('空闲时展示设目标表单，提交调用进入目标模式命令', async () => {
    renderStack();
    // 面板默认折叠 —— 先点开 chip。
    fireEvent.click(screen.getByTestId('corner-goal-chip'));
    const input = screen.getByTestId('corner-goal-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '把所有测试修绿' } });
    fireEvent.click(screen.getByTestId('corner-goal-start'));
    await vi.waitFor(() => expect(enterGoalMock).toHaveBeenCalledWith('把所有测试修绿', undefined, undefined));
  });

  it('活跃时 chip 高亮并展示状态徽标', () => {
    useAgentStore.setState({ goalActive: true });
    renderStack();
    const chip = screen.getByTestId('corner-goal-chip');
    expect(chip.className).toContain('chipActive');
    expect(screen.getByTestId('corner-goal-active')).toBeDefined();
  });
});

describe('SubagentsWidget', () => {
  it('无子代理活动时不渲染', () => {
    renderStack();
    expect(screen.queryByTestId('corner-subagents')).toBeNull();
  });

  it('有运行中 child 时展示徽标与中断按钮', () => {
    useAgentStore.setState({
      subagents: {
        feed: [{ id: 'e1', childId: 'c1', role: 'reviewer', kind: 'message', text: '开始审查', at: 1 }],
        lastStatus: [
          {
            child_id: 'c1',
            role: 'reviewer',
            state: 'running',
            started_at: '2026-01-01T00:00:00Z',
            iteration: 2,
            total_tokens: 0,
          },
        ],
      },
    });
    renderStack();
    const chip = screen.getByTestId('corner-subagents-chip');
    expect(chip.className).toContain('chipActive');
    fireEvent.click(chip);
    expect(screen.getByTestId('corner-subagents-panel').textContent).toContain('reviewer');
    expect(screen.getByTestId('corner-subagents-interrupt-c1')).toBeDefined();
  });
});

describe('SuggestionsWidget', () => {
  it('常驻展示，点击建议卡预填 composer', () => {
    renderStack();
    expect(screen.getByTestId('corner-suggestions')).toBeDefined();
    // 面板默认折叠 —— 先点开 chip。
    fireEvent.click(screen.getByTestId('corner-suggestions-chip'));
    fireEvent.click(screen.getByTestId('corner-suggestion-explore'));
    expect(prefillMock).toHaveBeenCalledTimes(1);
    expect((prefillMock.mock.calls[0]?.[0] as string).length).toBeGreaterThan(0);
  });
});
