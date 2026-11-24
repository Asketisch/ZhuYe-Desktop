/**
 * PlanDock —— 右 dock 计划标签页渲染测试（从 Inspector 计划用例迁出）。
 *
 * 验证：终稿 Markdown / 草稿兜底 / 终稿优先 / 空态 / 审批卡片三种决策 /
 * 请求卡片冗余 enter 不渲染 / 草稿未提交「提交并执行」入口。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { PlanDock } from './PlanDock';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { resetMockInvoke, createTestQueryClient, mockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}><I18nProvider>{node}</I18nProvider></QueryClientProvider>;
}

function captureApproval(): Array<{ id: string; choice: string }> {
  const calls: Array<{ id: string; choice: string }> = [];
  mockInvoke('zhuye_plan_approval', async (_cmd: string, args: { id: string; choice: string }) => {
    calls.push(args);
    return 'sub-1';
  });
  return calls;
}

beforeEach(() => {
  resetMockInvoke();
  localStorage.clear();
  localStorage.setItem('zhuye.locale', 'zh-CN');
  useAgentStore.getState().reset();
  useShellUi.setState({ dockTabs: [], dockActiveId: null });
});
afterEach(() => cleanup());

function renderDock() {
  render(wrap(<PlanDock />));
  return screen.getByTestId('plan-dock');
}

describe('PlanDock — 计划正文', () => {
  it('终稿 Markdown 结构化渲染，显示落盘路径', () => {
    useAgentStore.setState({
      plan: { planId: 'p1', markdown: '## 官网建设计划\n1. 初始化 Hexo', path: '/w/.zhuye/plan/p1.md', status: 'approved' },
    });
    renderDock();
    expect(screen.getByTestId('plan-dock-final').textContent).toContain('/w/.zhuye/plan/p1.md');
    const body = screen.getByTestId('plan-dock-body');
    expect(body.querySelector('h2')?.textContent).toBe('官网建设计划');
    expect(body.querySelector('li')?.textContent).toContain('初始化 Hexo');
    expect(body.textContent).not.toContain('## 官网建设计划');
  });

  it('无终稿时回落到实时草稿', () => {
    useAgentStore.setState({
      plan: null,
      planDraft: { markdown: '草稿:搭建 Hexo 骨架', path: '/w/.zhuye/plan/draft.md' },
    });
    renderDock();
    expect(screen.getByTestId('plan-dock-draft')).toBeDefined();
    expect(screen.getByTestId('plan-dock-draft-body').textContent).toContain('草稿:搭建 Hexo 骨架');
  });

  it('终稿优先于草稿', () => {
    useAgentStore.setState({
      plan: { planId: 'p1', markdown: 'FINAL', status: 'ready' },
      planDraft: { markdown: 'DRAFT' },
    });
    const dock = renderDock();
    expect(dock.textContent).toContain('FINAL');
    expect(dock.textContent).not.toContain('DRAFT');
  });

  it('无计划无草稿且无 TodoWrite 时显示空态', () => {
    const dock = renderDock();
    expect(dock.textContent).toContain('TodoWrite');
  });
});

describe('PlanDock — 审批卡片', () => {
  it('ready 显示同意执行 / 逐项确认 / 打回修订', async () => {
    const calls = captureApproval();
    useAgentStore.setState({
      pendingPlan: { id: 'p1', kind: 'ready', payload: { markdown: '# Plan' }, turnId: 't1' },
      plan: { planId: 'p1', markdown: '## 计划正文', path: null, status: 'ready' },
    });
    renderDock();
    fireEvent.click(screen.getByTestId('plan-dock-approve'));
    await waitFor(() => expect(calls).toEqual([{ id: 'p1', choice: 'auto_mode' }]));
    fireEvent.click(screen.getByTestId('plan-dock-manual'));
    await waitFor(() => expect(calls[1]).toEqual({ id: 'p1', choice: 'manual_approve' }));
    fireEvent.click(screen.getByTestId('plan-dock-revise'));
    await waitFor(() => expect(calls[2]).toEqual({ id: 'p1', choice: 'revise' }));
    expect(screen.getByTestId('plan-dock-body').textContent).toContain('计划正文');
  });

  it('request 显示进入 / 暂不；计划模式下不渲染确认卡', async () => {
    const calls = captureApproval();
    useAgentStore.setState({
      permissionMode: 'auto',
      pendingPlan: { id: 'p2', kind: 'request', payload: { task: '调研迁移' }, turnId: 't1' },
    });
    renderDock();
    expect(screen.getByTestId('plan-dock-pending').textContent).toContain('调研迁移');
    fireEvent.click(screen.getByTestId('plan-dock-enter'));
    await waitFor(() => expect(calls).toEqual([{ id: 'p2', choice: 'manual_approve' }]));

    useAgentStore.setState({ permissionMode: 'plan' });
    cleanup();
    renderDock();
    expect(screen.queryByTestId('plan-dock-pending')).toBeNull();
  });
});
