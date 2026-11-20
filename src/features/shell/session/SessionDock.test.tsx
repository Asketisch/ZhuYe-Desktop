/**
 * SessionDock + StatusPanel —— 会话内速控行与右上角状态面板测试。
 *
 * 架构：任务清单 / 目标 / 计划 三块在右上角浮动状态面板（StatusPanel，
 * 分节 + mini 胶囊）；子代理 / 建议 / 排队 留在 composer 上方的 chips 行
 * （SessionDock）。本文件同时钉住两块的行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { SessionDock } from '@/features/shell/session/SessionDock';
import { StatusPanel } from '@/features/shell/session/StatusPanel';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke, mockInvoke } from '@/test/setup.tsx';

function renderDock() {
  return render(
    <I18nProvider>
      <SessionDock goalActive={false} goalText="" turnRunning={false} />
    </I18nProvider>,
  );
}

function renderPanel(props: { goalActive?: boolean; goalText?: string } = {}) {
  return render(
    <I18nProvider>
      <StatusPanel
        goalActive={props.goalActive ?? false}
        goalText={props.goalText ?? ''}
        turnRunning={false}
      />
    </I18nProvider>,
  );
}

describe('SessionDock · 会话内速控行', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('有子代理活动时出子代理 chip', () => {
    useAgentStore.setState({
      subagents: {
        feed: [{ id: 'f1', role: 'reviewer', text: '正在审查', kind: 'text' }],
        lastStatus: null,
      },
    } as never);
    renderDock();
    expect(screen.getByTestId('session-dock-subagents')).toBeTruthy();
  });

  it('建议 chip 常驻，展开后列出快捷 prompt', () => {
    renderDock();
    const chip = screen.getByTestId('session-dock-suggestions');
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.getByTestId('corner-suggestions-body')).toBeTruthy();
  });

  it('无排队消息时不出排队 chip', () => {
    renderDock();
    expect(screen.queryByTestId('session-dock-queue')).toBeNull();
  });

  it('不再承载任务 / 目标 chips（已迁移到状态面板）', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderDock();
    expect(screen.queryByTestId('session-dock-todo')).toBeNull();
    expect(screen.queryByTestId('session-dock-goal')).toBeNull();
  });
});

describe('StatusPanel · 右上角状态面板', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('空会话仅显示目标胶囊（常驻设目标入口）', () => {
    renderPanel();
    const pill = screen.getByTestId('status-panel-pill');
    expect((pill.textContent ?? '').toLowerCase()).toContain('goal');
    expect(screen.queryByText('1/2')).toBeNull();
  });

  it('mini 胶囊显示进行中的 todo，点击展开为面板', () => {
    useAgentStore.setState({
      todos: [
        { content: '读需求', status: 'completed' },
        { content: '写实现', status: 'in_progress', active_form: '正在写实现' },
      ],
    });
    renderPanel();
    const pill = screen.getByTestId('status-panel-pill');
    expect(pill.textContent ?? '').toContain('正在写实现');
    expect(pill.textContent).toContain('1/2');
    fireEvent.click(pill);
    expect(screen.getByTestId('status-panel')).toBeTruthy();
    // 展开后「进程」节列出三态清单。
    expect(screen.getAllByTestId('status-panel-todo-row').length).toBe(2);
    expect(screen.getByText('读需求')).toBeTruthy();
  });

  it('面板提供「设目标」表单（目标节）', () => {
    mockInvoke('zhuye_enter_goal_mode', async () => undefined);
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('status-panel-pill'));
    expect(screen.getByTestId('status-panel-goal')).toBeTruthy();
    expect(screen.getByTestId('corner-goal-form')).toBeTruthy();
    expect(screen.getByTestId('corner-goal-input')).toBeTruthy();
  });

  it('目标活动时 mini 胶囊显示目标文本', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderPanel({ goalActive: true, goalText: '把功能做完' });
    const pill = screen.getByTestId('status-panel-pill');
    expect(pill.textContent ?? '').toContain('把功能做完');
  });

  it('有 plan 终稿时「计划」节可见，点击打开 dock 检查器 plan 页签', () => {
    useShellUiSetForTest();
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
      plan: { planId: 'p1', markdown: '# 实施计划\n\n第一步', status: 'ready' },
    } as never);
    renderPanel();
    fireEvent.click(screen.getByTestId('status-panel-pill'));
    expect(screen.getByTestId('status-panel-plan')).toBeTruthy();
    expect(screen.getByText('实施计划')).toBeTruthy();
    fireEvent.click(screen.getByTestId('status-panel-plan'));
    // 打开 dock 检查器并切到 plan 页签（shellUi 状态断言）。
    expect(useShellUiGet().dockOpen).toBe(true);
    expect(useShellUiGet().dockMode).toBe('inspector');
    expect(useShellUiGet().inspectorTab).toBe('plan');
  });

  it('面板可收起为胶囊（collapse 按钮）', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('status-panel-pill'));
    expect(screen.getByTestId('status-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('status-panel-collapse'));
    expect(screen.getByTestId('status-panel-pill')).toBeTruthy();
    expect(screen.queryByTestId('status-panel')).toBeNull();
  });
});

/* ---- shellUi 测试辅助（避免直接 import store 类型噪音） ---- */
import { useShellUi } from '@/stores/shellUi';
function useShellUiGet() {
  return useShellUi.getState();
}
function useShellUiSetForTest() {
  useShellUi.setState({ dockOpen: false, dockMode: 'inspector', inspectorTab: 'overview' });
}
