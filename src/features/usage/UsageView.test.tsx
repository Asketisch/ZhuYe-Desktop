/**
 * Vitest — UsageView 测试(模型级 token 统计视图)。
 *
 * 覆盖三态:未绑定会话(空态)/ 已绑定且有统计(数据渲染)/ 全部会话
 * 按模型合计表。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { UsageView } from '@/features/usage/UsageView';
import { useAgentStore } from '@/stores/agentStore';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const STATS = {
  sessionId: SESSION_ID,
  model: 'openai/gpt-4o',
  startedAt: '2026-10-01T00:00:00Z',
  messageCount: 12,
  toolCalls: 3,
  compactions: 1,
  compactionBeforeTokens: 9000,
  compactionAfterTokens: 2000,
  compactionTokensSaved: 7000,
  memoryReads: 2,
  memoryWrites: 1,
  inputTokens: 1000,
  outputTokens: 200,
  cachedTokens: 250,
  cacheWriteTokens: 0,
  totalTokens: 1200,
  costUsd: 0.0234,
  cacheHitRate: 0.25,
  perModel: [
    {
      model: 'openai/gpt-4o',
      provider: 'openai',
      calls: 4,
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 250,
      cacheWriteTokens: 0,
      totalTokens: 1200,
      costUsd: 0.0234,
    },
  ],
};

const MODELS = [
  {
    model: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    calls: 9,
    inputTokens: 4000,
    outputTokens: 800,
    cachedTokens: 1000,
    cacheWriteTokens: 0,
    totalTokens: 4800,
    costUsd: 0.12,
  },
];

describe('UsageView', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.setState({ loadedSessionId: null });
    mockInvoke('reflect_all_model_usage', async () => []);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAgentStore.setState({ loadedSessionId: null });
  });

  it('renders the empty state when no session is bound', async () => {
    render(wrap(<UsageView />));
    expect(await screen.findByText(/No session bound yet/i)).toBeDefined();
  });

  it('renders session stats and the per-model table when a session is bound', async () => {
    useAgentStore.setState({ loadedSessionId: SESSION_ID });
    mockInvoke('reflect_session_stats', async () => STATS);

    render(wrap(<UsageView />));

    const stats = await screen.findByTestId('usage-session-stats');
    expect(stats.textContent).toContain('openai/gpt-4o');
    expect(stats.textContent).toContain('1,000');
    expect(stats.textContent).toContain('1,200');
    // 压缩节省(1 次压缩 · 7000 token)与记忆访问(2 读 / 1 写)。
    expect(stats.textContent).toContain('7,000');
    expect(stats.textContent).toContain('2 / 1');
    // 按模型拆分的表。
    const table = await screen.findByTestId('usage-model-table');
    expect(table.textContent).toContain('openai/gpt-4o');
    expect(table.textContent).toContain('openai');
  });

  it('renders the all-sessions model table', async () => {
    mockInvoke('reflect_all_model_usage', async () => MODELS);

    render(wrap(<UsageView />));

    // 表头先出现,数据行随查询落地 —— 等数据本身而不是等表。
    expect(await screen.findByText('anthropic/claude-sonnet-4')).toBeDefined();
    expect(screen.getByText('4,800')).toBeDefined();
  });

  it('surfaces stats errors without crashing', async () => {
    useAgentStore.setState({ loadedSessionId: SESSION_ID });
    mockInvoke('reflect_session_stats', async () => {
      throw new Error('rollout dir unreadable');
    });

    render(wrap(<UsageView />));
    expect(await screen.findByText(/rollout dir unreadable/i)).toBeDefined();
  });

  it('renders the live per-model breakdown from the store projection', async () => {
    // live 投影来自 store(实时 token_count 事件累计),不是后端查询。
    useAgentStore.setState({
      tokens: {
        input: 100, output: 20, cached: 0, cacheWrite: 0, total: 120,
        provider: 'anthropic', credentialLabel: null, model: 'anthropic/claude-sonnet-4-latest',
        cost: 0.001, sessionCost: 0.001, sessionTotal: 120,
        byModel: {
          'anthropic/claude-sonnet-4-latest': {
            model: 'anthropic/claude-sonnet-4-latest',
            provider: 'anthropic',
            calls: 2,
            input: 100, output: 20, cached: 0, cacheWrite: 0, total: 120,
            cost: 0.001,
          },
        },
      },
    });
    mockInvoke('reflect_all_model_usage', async () => []);

    render(wrap(<UsageView />));

    const live = await screen.findByTestId('usage-live-table');
    expect(live.textContent).toContain('anthropic/claude-sonnet-4-latest');
    expect(live.textContent).toContain('2');
    expect(live.textContent).toContain('120');
  });

  it('renders the rate card so costs are explainable', async () => {
    useAgentStore.setState({ loadedSessionId: SESSION_ID });
    mockInvoke('reflect_session_stats', async () => STATS);
    mockInvoke('reflect_all_model_usage', async () => []);
    mockInvoke('reflect_model_rate_cards', async () => [
      {
        model: 'openai/gpt-4o',
        priced: true,
        inputPrice: 3,
        outputFactor: 5,
        cacheReadFactor: 0.1,
        cacheWriteFactor: 1.25,
        outputPrice: 15,
        cacheReadPrice: 0.3,
        cacheWritePrice: 3.75,
      },
    ]);

    render(wrap(<UsageView />));

    const rates = await screen.findByTestId('usage-rate-card-table');
    expect(rates.textContent).toContain('openai/gpt-4o');
    // 每 1M token 单价:输入 $3.00 / 输出 $15.00。
    expect(rates.textContent).toContain('$3.00');
    expect(rates.textContent).toContain('$15.00');
  });
});
