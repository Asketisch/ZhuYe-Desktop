/**
 * ZDock —— 会话内 chips 行测试。
 *
 * 回归背景：v3 把「任务 / 目标 / 子代理 / 建议」四块挂在**窗口右上角**
 * 的 fixed 浮层（CornerStack），在所有路由都飘着，且与 composer 上方
 * ZDock 里已有的任务/目标 chip 重复。v3 起四块并入本行，随会话出现。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { ZDock } from '@/features/shell/zcode/ZDock';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke, mockInvoke } from '@/test/setup.tsx';

function renderDock(props: { goalActive?: boolean; goalText?: string } = {}) {
  return render(
    <I18nProvider>
      <ZDock
        goalActive={props.goalActive ?? false}
        goalText={props.goalText ?? ''}
        turnRunning={false}
      />
    </I18nProvider>,
  );
}

describe('ZDock · 会话内 chips 行', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('目标 chip 常驻（提供「设目标」入口）', () => {
    renderDock();
    expect(screen.getByTestId('zcode-dock-goal')).toBeTruthy();
  });

  it('无任务时不出任务 chip', () => {
    renderDock();
    expect(screen.queryByTestId('zcode-dock-todo')).toBeNull();
  });

  it('有任务时出任务 chip，展开后列出清单', () => {
    useAgentStore.setState({
      todos: [
        { content: '读需求', status: 'completed' },
        { content: '写实现', status: 'in_progress', active_form: '正在写实现' },
      ],
    });
    renderDock();
    const chip = screen.getByTestId('zcode-dock-todo');
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.getByTestId('corner-todo-body')).toBeTruthy();
    expect(screen.getByText('读需求')).toBeTruthy();
  });

  it('有子代理活动时出子代理 chip', () => {
    useAgentStore.setState({
      subagents: {
        feed: [{ id: 'f1', role: 'reviewer', text: '正在审查', kind: 'text' }],
        lastStatus: null,
      },
    } as never);
    renderDock();
    expect(screen.getByTestId('zcode-dock-subagents')).toBeTruthy();
  });

  it('建议 chip 常驻，展开后列出快捷 prompt', () => {
    renderDock();
    const chip = screen.getByTestId('zcode-dock-suggestions');
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.getByTestId('corner-suggestions-body')).toBeTruthy();
  });

  it('四个 chip 同处一行（不再是窗口级浮层）', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
      subagents: {
        feed: [{ id: 'f1', role: 'worker', text: '干活中', kind: 'text' }],
        lastStatus: null,
      },
    } as never);
    renderDock({ goalActive: true, goalText: '把功能做完' });
    const dock = screen.getByTestId('zcode-dock');
    for (const id of ['zcode-dock-todo', 'zcode-dock-goal', 'zcode-dock-subagents', 'zcode-dock-suggestions']) {
      const el = screen.getByTestId(id);
      expect(dock.contains(el), `${id} 应在会话内 chips 行内`).toBe(true);
    }
  });

  it('目标 chip 的空闲态提供「设目标」表单', () => {
    mockInvoke('zhuye_enter_goal_mode', async () => undefined);
    renderDock();
    fireEvent.click(screen.getByTestId('zcode-dock-goal'));
    expect(screen.getByTestId('corner-goal-form')).toBeTruthy();
    expect(screen.getByTestId('corner-goal-input')).toBeTruthy();
  });
});
