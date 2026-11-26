/**
 * SessionDock + SessionCapsule —— 会话内速控行与折叠胶囊测试。
 *
 * 架构（v1.13）：任务清单 / 目标 / 上下文 三块收进**会话区的折叠胶囊**
 * （SessionCapsule，收起=单行摘要 / 展开=分节面板）；计划正文仍在右 dock
 * 的「计划」标签页，胶囊里只给跳转入口。子代理 / 排队留在 composer 上方
 * 的 chips 行（SessionDock）。本文件同时钉住两块的行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient } from '@/test/setup';
import { SessionDock } from '@/features/shell/session/SessionDock';
import { SessionCapsule } from '@/features/shell/session/SessionCapsule';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke, mockInvoke } from '@/test/setup.tsx';

function renderDock() {
  return render(
    <I18nProvider>
      <SessionDock goalActive={false} goalText="" turnRunning={false} />
    </I18nProvider>,
  );
}

function renderCapsule(props: { goalActive?: boolean } = {}) {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SessionCapsule goalActive={props.goalActive ?? false} turnRunning={false} />
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

  it('v1.13:不再有「建议」chip（模板统一收进「+」菜单的二级目录）', () => {
    renderDock();
    expect(screen.queryByTestId('session-dock-suggestions')).toBeNull();
  });

  it('无排队消息时不出排队 chip', () => {
    renderDock();
    expect(screen.queryByTestId('session-dock-queue')).toBeNull();
  });

  it('不再承载任务 / 目标 chips（已迁移到折叠胶囊）', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderDock();
    expect(screen.queryByTestId('session-dock-todo')).toBeNull();
    expect(screen.queryByTestId('session-dock-goal')).toBeNull();
  });
});

describe('SessionCapsule · 会话区折叠胶囊', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    useAgentStore.getState().reset();
    mockInvoke('zhuye_credential_pool_status', async () => []);
  });
  afterEach(() => cleanup());

  it('空闲态不占位（没有内容就没有胶囊）', () => {
    renderCapsule();
    expect(screen.queryByTestId('session-capsule')).toBeNull();
  });

  it('有 todo 时出胶囊；收起只显单行摘要，展开才出分节', () => {
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
    });
    renderCapsule();
    expect(screen.getByTestId('session-capsule')).toBeTruthy();
    // 收起态：分节内容不渲染。
    expect(screen.queryByTestId('capsule-todo-row')).toBeNull();
    fireEvent.click(screen.getByTestId('session-capsule-summary'));
    expect(screen.getByTestId('capsule-todo-row')).toBeTruthy();
  });

  it('进程节直接列出 todo 三态与完成计数', () => {
    useAgentStore.setState({
      todos: [
        { content: '读需求', status: 'completed' },
        { content: '写实现', status: 'in_progress', active_form: '正在写实现' },
      ],
    });
    renderCapsule();
    fireEvent.click(screen.getByTestId('session-capsule-summary'));
    expect(screen.getAllByTestId('capsule-todo-row').length).toBe(2);
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
    renderCapsule({ goalActive: true });
    fireEvent.click(screen.getByTestId('session-capsule-summary'));
    const elapsed = screen.getByTestId('capsule-goal-elapsed');
    expect(elapsed.textContent).toContain('⏱');
    expect(elapsed.textContent).toContain('分');
  });

  it('有 plan 终稿时给跳转入口，点击打开 dock 计划标签页', () => {
    useShellUiSetForTest();
    useAgentStore.setState({
      todos: [{ content: '任务一', status: 'pending' }],
      plan: { planId: 'p1', markdown: '# 实施计划\n\n第一步', status: 'ready' },
    } as never);
    renderCapsule();
    fireEvent.click(screen.getByTestId('session-capsule-summary'));
    expect(screen.getByTestId('capsule-plan')).toBeTruthy();
    expect(screen.getByText('实施计划')).toBeTruthy();
    fireEvent.click(screen.getByTestId('capsule-plan'));
    expect(useShellUiGet().dockOpen).toBe(true);
    expect(useShellUiGet().dockTabs.some((tab) => tab.kind === 'plan')).toBe(true);
    expect(useShellUiGet().dockActiveId).toBe('plan');
  });

  it('上下文容量节：总进度 + 缓存命中率（有 token 上报时）', () => {
    useAgentStore.setState({
      tokens: {
        input: 1000,
        output: 500,
        cached: 800,
        cacheWrite: 0,
        total: 1500,
        // 本回合累计(命中率走回合级口径)。
        turn: {
          turnId: 't1',
          input: 1000,
          output: 500,
          cached: 800,
          cacheWrite: 0,
          total: 1500,
        },
      },
      contextWindowSize: 100_000,
    } as never);
    renderCapsule();
    fireEvent.click(screen.getByTestId('session-capsule-summary'));
    expect(screen.getByTestId('capsule-context')).toBeTruthy();
    expect(screen.getByTestId('capsule-context-pct').textContent).toBe('2%');
    expect(screen.getByTestId('capsule-cache-hit').textContent).toBe('80%');
  });
});
/* ---- shellUi 测试辅助（避免直接 import store 类型噪音） ---- */
import { useShellUi } from '@/stores/shellUi';
function useShellUiGet() {
  return useShellUi.getState();
}
function useShellUiSetForTest() {
  useShellUi.setState({ dockOpen: false, dockTabs: [], dockActiveId: null });
}
