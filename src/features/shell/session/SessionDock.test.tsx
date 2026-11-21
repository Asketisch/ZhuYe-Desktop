/**
 * SessionDock + StatusPanel —— 会话内速控行与右上角状态面板测试。
 *
 * 架构：任务清单 / 目标 / 计划 三块在右上角浮动状态面板（StatusPanel，
 * 分节 + mini 胶囊）；子代理 / 建议 / 排队 留在 composer 上方的 chips 行
 * （SessionDock）。本文件同时钉住两块的行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient } from '@/test/setup';
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
      <QueryClientProvider client={createTestQueryClient()}>
        <StatusPanel
          goalActive={props.goalActive ?? false}
          goalText={props.goalText ?? ''}
          turnRunning={false}
        />
      </QueryClientProvider>
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

describe('StatusPanel · 常驻工作台右列', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    useAgentStore.getState().reset();
    mockInvoke('zhuye_credential_pool_status', async () => []);
  });
  afterEach(() => cleanup());

  it('空会话显示空闲提示（面板常驻 + /goal 引导，无输入表单）', () => {
    renderPanel();
    expect(screen.getByTestId('workbench-panel')).toBeTruthy();
    expect(screen.getByText(/Nothing running yet/)).toBeTruthy();
    expect(screen.getByTestId('status-panel-goal')).toBeTruthy();
    // 只读面板:目标输入唯一入口是 composer /goal —— 面板只有引导按钮,
    // 不提供 textarea / 预算输入 / 启动按钮(对标 ZCode ConversationStatusPanel)。
    expect(screen.getByTestId('corner-goal-form')).toBeTruthy();
    expect(screen.getByTestId('corner-goal-fill-slash')).toBeTruthy();
    expect(screen.queryByTestId('corner-goal-input')).toBeNull();
    expect(screen.queryByTestId('corner-goal-budget')).toBeNull();
    expect(screen.queryByTestId('corner-goal-start')).toBeNull();
  });

  it('进程节直接列出 todo 三态与完成计数', () => {
    useAgentStore.setState({
      todos: [
        { content: '读需求', status: 'completed' },
        { content: '写实现', status: 'in_progress', active_form: '正在写实现' },
      ],
    });
    renderPanel();
    expect(screen.getAllByTestId('status-panel-todo-row').length).toBe(2);
    expect(screen.getByText('读需求')).toBeTruthy();
    expect(screen.getByText('正在写实现')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('目标激活时显示计时（⏱ 分秒）', () => {
    useAgentStore.setState({
      goalSnapshot: {
        goal: '把功能做完', verify_command: null, token_budget: null,
        status: 'active', tokens_used: 0, turn_count: 0,
        consecutive_blocked_turns: 0,
        started_at: new Date(Date.now() - 90_000).toISOString(), turns: [],
      },
    } as never);
    renderPanel({ goalActive: true, goalText: '把功能做完' });
    const elapsed = screen.getByTestId('status-panel-goal-elapsed');
    expect(elapsed.textContent).toContain('⏱');
    expect(elapsed.textContent).toContain('分');
  });

  it('有 plan 终稿时「计划」节可见，点击打开 dock 检查器 plan 页签', () => {
    useShellUiSetForTest();
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
      plan: { planId: 'p1', markdown: '# 实施计划\n\n第一步', status: 'ready' },
    } as never);
    renderPanel();
    expect(screen.getByTestId('status-panel-plan')).toBeTruthy();
    expect(screen.getByText('实施计划')).toBeTruthy();
    fireEvent.click(screen.getByTestId('status-panel-plan'));
    expect(useShellUiGet().dockOpen).toBe(true);
    expect(useShellUiGet().dockMode).toBe('inspector');
    expect(useShellUiGet().inspectorTab).toBe('plan');
  });

  it('可折叠为窄条并可展开（collapse / expand）', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderPanel();
    expect(screen.getByTestId('workbench-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('status-panel-collapse'));
    expect(screen.getByTestId('workbench-collapsed')).toBeTruthy();
    expect(screen.queryByTestId('workbench-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('workbench-expand'));
    expect(screen.getByTestId('workbench-panel')).toBeTruthy();
  });

  it('上下文容量节：总进度 + 缓存命中率（有 token 上报时）', () => {
    useAgentStore.setState({
      tokens: { input: 1000, output: 500, cached: 800, cacheWrite: 0, total: 1500 },
      contextWindowSize: 100_000,
    } as never);
    renderPanel();
    expect(screen.getByTestId('status-panel-context')).toBeTruthy();
    expect(screen.getByTestId('status-panel-context-pct').textContent).toBe('2%');
    expect(screen.getByTestId('status-panel-cache-hit').textContent).toBe('80%');
  });

  it('凭据池节：组健康计数（healthy/total）', async () => {
    mockInvoke('zhuye_credential_pool_status', async () => [
      { group: 'demo', endpoint: 'openai', total: 2, healthy: 2, healthyLabels: ['a', 'b'] },
    ]);
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('status-panel-pool')).toBeTruthy());
    expect(screen.getByText('demo')).toBeTruthy();
    expect(screen.getByText('2/2')).toBeTruthy();
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
