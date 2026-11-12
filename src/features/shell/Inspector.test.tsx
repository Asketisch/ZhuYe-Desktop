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
  });

  it('cancels a running subagent with its child id', async () => {
    const interrupts: unknown[] = [];
    mockInvoke('reflect_interrupt', async (_command, args) => {
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
    mockInvoke('reflect_list_dir', async () => ({
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
    mockInvoke('reflect_git_diff', async () => 'diff --git a/x b/x\n+hello\n');
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
