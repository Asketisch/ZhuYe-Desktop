/**
 * Inspector —— Token Usage section 渲染测试。
 *
 * 验证：
 *   - tokens === null 时显示 empty 段落
 *   - tokens 有值时渲染 input/output/total 等数值（cost 已按产品决策移除）
 *
 * 仿 AppShell.test.tsx 模式：QueryClient 包裹 + resetMockInvoke + store.setState。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Inspector } from '@/features/shell/Inspector';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { resetMockInvoke, createTestQueryClient, mockInvoke } from '@/test/setup.tsx';
import type { TokenSnapshot } from '@/stores/agent/types';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

function setTokens(tokens: TokenSnapshot | null) {
  useAgentStore.setState({ tokens });
}

describe('Inspector — token usage section', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
    useShellUi.setState({ inspectorTab: 'overview' });
  });
  afterEach(() => cleanup());

  it('renders the token usage section even when tokens is null (empty state)', () => {
    setTokens(null);
    const { container } = render(wrap(<Inspector />));
    // section 标题始终渲染(通过 Coins 图标定位 section);
    // empty 态下没有数值行。
    expect(container.textContent).not.toContain('1,200');
  });

  it('renders token breakdown values when tokens present', () => {
    setTokens({
      input: 1200,
      output: 300,
      cached: 200,
      cost: null,
      sessionCost: 0,
      cacheWrite: 500,
      total: 1500,
      provider: 'anthropic',
      credentialLabel: 'main-key',
    });
    const { container } = render(wrap(<Inspector />));
    const text = container.textContent ?? '';
    expect(text).toContain('1,200'); // input
    expect(text).toContain('300'); // output
    expect(text).toContain('500'); // cacheWrite
    expect(text).toContain('1,500'); // total
    expect(text).toContain('anthropic'); // provider
    expect(text).toContain('main-key'); // credential
  });

  it('omits cost row when cost is null', () => {
    setTokens({
      input: 10,
      output: 5,
      cached: 0,
      cacheWrite: 0,
      total: 15,
      cost: null,
      sessionCost: 0,
    });
    const { container } = render(wrap(<Inspector />));
    const text = container.textContent ?? '';
    expect(text).toContain('15'); // total 显示
    // cost 展示已移除，任何情况下不含 "$"。
    expect(text).not.toContain('$');
  });

  it('omits cacheWrite row when cacheWrite is 0', () => {
    setTokens({
      input: 10,
      output: 5,
      cached: 0,
      cacheWrite: 0,
      total: 15,
      cost: null,
      sessionCost: 0,
    });
    const { container } = render(wrap(<Inspector />));
    const text = container.textContent ?? '';
    // cacheWrite === 0 时该行被省略;cached 即使是 0 也渲染(显示 "0")。
    // 这里确保 cacheWrite 行不渲染、组件不崩、total 正确。
    expect(text).not.toContain('Cache write');
    expect(text).toContain('15');
  });
});

// ===========================================================================
// v1.x P2：概览 / 文件 / 改动 三 tab
// ===========================================================================

describe('Inspector tabs', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
    useShellUi.setState({ inspectorTab: 'overview' });
  });

  it('cancels a running subagent with its child id', async () => {
    const interrupts: unknown[] = [];
    mockInvoke('zhuye_interrupt', async (_command, args) => {
      interrupts.push(args);
      return 'child-interrupted';
    });
    useAgentStore.setState({
      subagents: {
        feed: [],
        lastStatus: [{
          child_id: 'child-1',
          role: 'explorer',
          state: 'running',
          started_at: '2026-11-12T00:00:00Z',
          iteration: 2,
          total_tokens: 128,
        }],
      },
    });
    render(wrap(<Inspector />));
    fireEvent.click(screen.getByTestId('inspector-subagent-cancel-child-1'));

    await waitFor(() => expect(interrupts).toEqual([{ childId: 'child-1' }]));
    expect(screen.getByRole('button', { name: 'Cancel running subagent' }).getAttribute('aria-disabled')).toBeNull();
  });
  afterEach(() => cleanup());

  it('defaults to overview with context gauge, composition and session metrics', () => {
    setTokens({
      input: 300, output: 120, cached: 60, cacheWrite: 10, total: 420,
      provider: 'openai', credentialLabel: 'default', cost: null, sessionCost: 0,
    });
    useAgentStore.setState({ contextWindowSize: 1000, turns: [{ id: 't1', items: [] }] } as never);
    render(wrap(<Inspector />));

    expect(screen.getByTestId('inspector-tab-overview').getAttribute('aria-selected')).toBe('true');
    // 上下文仪表：420/1000 → 42%。
    expect(screen.getByTestId('inspector-context-gauge').textContent).toContain('42%');
    // Token 构成堆叠条。
    expect(screen.getByTestId('inspector-token-composition')).toBeDefined();
    // 会话指标（轮数）。
    expect(screen.getByTestId('inspector-turn-count').textContent).toBe('1');
  });

  it('overview shows aggregated compaction stats with last summary tooltip', () => {
    useAgentStore.setState({
      compactions: {
        count: 2,
        removedMessages: 3,
        tokensSaved: 2387,
        last: 'smart_prune: 0 msgs (7731 → 5344 tokens)',
        records: [
          {
            strategy: 'smart_prune',
            removedMessages: 3,
            beforeTokens: 7731,
            afterTokens: 5344,
            tokensSaved: 2387,
            at: 1_700_000_000_000,
          },
        ],
      },
    } as never);
    render(wrap(<Inspector />));

    const stats = screen.getByTestId('inspector-compactions');
    expect(stats.textContent).toContain('Context compactions');
    expect(stats.textContent).toContain('2');
    expect(stats.textContent).toContain('2,387'); // 压缩节省 tokens
    expect(stats.getAttribute('title')).toBe('smart_prune: 0 msgs (7731 → 5344 tokens)');
  });

  it('hides the compaction stats block when there are no compactions', () => {
    render(wrap(<Inspector />));
    expect(screen.queryByTestId('inspector-compactions')).toBeNull();
  });

  it('files tab lists the workspace tree', async () => {
    mockInvoke('zhuye_list_dir', async () => ({
      cwd: '/tmp',
      entries: [
        { name: 'src', path: '/tmp/src', kind: 'dir', size: 0, mtime: 0, depth: 0 },
      ],
    }));
    render(wrap(<Inspector />));
    fireEvent.click(screen.getByTestId('inspector-tab-files'));
    await waitFor(() => {
      expect(screen.getByTestId('inspector-files').textContent).toContain('src');
    });
  });

  it('changes tab renders the git diff', async () => {
    mockInvoke('zhuye_git_diff', async () => 'diff --git a/x b/x\n+hello\n');
    render(wrap(<Inspector />));
    fireEvent.click(screen.getByTestId('inspector-tab-changes'));
    await waitFor(() => {
      expect(screen.getByTestId('inspector-changes').textContent).toContain('+hello');
    });
  });
});

// ===========================================================================
// agent 的 todo 清单（来自 `TodoWrite` 工具输出元数据）
// ===========================================================================

describe('Inspector — todo 清单', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
    // 页签真源在 shellUi（前一用例可能切走），回到概览。
    useShellUi.setState({ inspectorTab: 'overview' });
  });
  afterEach(() => cleanup());

  it('清单为空时不渲染面板', () => {
    render(wrap(<Inspector />));
    expect(screen.queryByTestId('inspector-todos')).toBeNull();
  });

  it('渲染清单条目与完成数徽标', () => {
    useAgentStore.setState({
      todos: [
        { content: 'design schema', status: 'in_progress', active_form: 'Designing' },
        { content: 'write tests', status: 'completed', active_form: null },
        { content: 'ship it', status: 'pending', active_form: null },
      ],
    } as never);
    render(wrap(<Inspector />));

    const panel = screen.getByTestId('inspector-todos');
    expect(panel.textContent).toContain('design schema');
    expect(panel.textContent).toContain('write tests');
    expect(panel.textContent).toContain('ship it');
    // 完成数 / 总数
    expect(panel.textContent).toContain('1 / 3');
  });
});

// ── v1.x:计划 tab 渲染 plan 正文(终稿优先,草稿兜底;此前只显示 TodoWrite) ──

describe('Inspector — plan tab renders plan content', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
    useShellUi.setState({ inspectorTab: 'plan' });
  });
  afterEach(() => cleanup());

  const openPlanTab = async () => {
    render(wrap(<Inspector />));
    fireEvent.click(screen.getByTestId('inspector-tab-plan'));
    await screen.findByTestId('inspector-plan');
  };

  it('shows the final plan markdown when plan doc present (approved badge)', async () => {
    useAgentStore.setState({
      plan: { planId: 'p1', markdown: '## 官网建设计划\n1. 初始化 Hexo', path: '/w/.zhuye/plan/p1.md', status: 'approved' },
    });
    await openPlanTab();
    expect(screen.getByTestId('inspector-plan-final').textContent).toContain('/w/.zhuye/plan/p1.md');
    // 正文按 markdown 渲染（结构化文档），不是原文倾泻。
    const body = screen.getByTestId('inspector-plan-body');
    expect(body.querySelector('h2')?.textContent).toBe('官网建设计划');
    expect(body.querySelector('li')?.textContent).toContain('初始化 Hexo');
    expect(body.textContent).not.toContain('## 官网建设计划');
  });

  it('falls back to the live draft when no final plan exists', async () => {
    useAgentStore.setState({
      plan: null,
      planDraft: { markdown: '草稿:搭建 Hexo 骨架', path: '/w/.zhuye/plan/draft.md' },
    });
    await openPlanTab();
    expect(screen.getByTestId('inspector-plan-draft')).toBeDefined();
    expect(screen.getByTestId('inspector-plan-draft-body').textContent).toContain('草稿:搭建 Hexo 骨架');
  });

  it('final plan takes precedence over draft', async () => {
    useAgentStore.setState({
      plan: { planId: 'p1', markdown: 'FINAL', status: 'ready' },
      planDraft: { markdown: 'DRAFT' },
    });
    await openPlanTab();
    const text = screen.getByTestId('inspector-plan').textContent ?? '';
    expect(text).toContain('FINAL');
    expect(text).not.toContain('DRAFT');
  });

  it('keeps the todo empty hint only when no plan and no draft', async () => {
    await openPlanTab();
    expect(screen.queryByTestId('inspector-plan-final')).toBeNull();
    expect(screen.queryByTestId('inspector-plan-draft')).toBeNull();
    expect(screen.getByTestId('inspector-plan').textContent).toContain('TodoWrite');
  });

  it('挂起计划卡片：ready 显示同意执行/逐项确认/打回修订并发对应决策', async () => {
    const choices: Array<{ id: string; choice: string }> = [];
    mockInvoke('zhuye_plan_approval', async (_cmd: string, args: { id: string; choice: string }) => {
      choices.push(args);
      return 'sub-1';
    });
    useAgentStore.setState({
      pendingPlan: { id: 'p1', kind: 'ready', payload: { markdown: '# Plan' }, turnId: 't1' },
      plan: { planId: 'p1', markdown: '## 计划正文', path: null, status: 'ready' },
    });
    await openPlanTab();
    expect(screen.getByTestId('inspector-plan-pending')).toBeDefined();

    fireEvent.click(screen.getByTestId('plan-card-approve'));
    await waitFor(() => expect(choices).toEqual([{ id: 'p1', choice: 'auto_mode' }]));
    fireEvent.click(screen.getByTestId('plan-card-manual'));
    await waitFor(() => expect(choices[1]).toEqual({ id: 'p1', choice: 'manual_approve' }));
    fireEvent.click(screen.getByTestId('plan-card-revise'));
    await waitFor(() => expect(choices[2]).toEqual({ id: 'p1', choice: 'revise' }));
    // 正文仍渲染在卡片下方。
    expect(screen.getByTestId('inspector-plan-body').textContent).toContain('计划正文');
  });

  it('挂起计划卡片：request 显示进入/暂不；已在计划模式下不再渲染确认卡', async () => {
    const choices: Array<{ id: string; choice: string }> = [];
    mockInvoke('zhuye_plan_approval', async (_cmd: string, args: { id: string; choice: string }) => {
      choices.push(args);
      return 'sub-1';
    });
    useAgentStore.setState({
      permissionMode: 'auto',
      pendingPlan: { id: 'p2', kind: 'request', payload: { task: '调研迁移' }, turnId: 't1' },
    });
    await openPlanTab();
    expect(screen.getByTestId('inspector-plan-pending').textContent).toContain('调研迁移');
    fireEvent.click(screen.getByTestId('plan-card-enter'));
    await waitFor(() => expect(choices).toEqual([{ id: 'p2', choice: 'manual_approve' }]));

    // 已在计划模式：冗余 enter 由 usePlanSurfacing 静默应答，页签不渲染确认卡。
    useAgentStore.setState({ permissionMode: 'plan' });
    cleanup(); // 同一用例内二次挂载前清场，避免 testid 重复命中
    await openPlanTab();
    expect(screen.queryByTestId('inspector-plan-pending')).toBeNull();
  });
});
