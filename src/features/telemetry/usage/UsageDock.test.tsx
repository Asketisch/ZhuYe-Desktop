/**
 * Vitest — UsageDock 测试（右 dock 用量面板）。
 *
 * 覆盖：本会话总量大数字 + token 三分段 / stats 为 null 时的优雅回退 /
 * 跨会话成本对比（当前会话 `.top` 高亮）/ 模型费率卡。
 *
 * 会话列表走 setup 默认 stub（sess-1/2/3）;stats 与费率按用例覆写。
 * 会话 id 来自路由（useActiveSession）→ mock @tanstack/react-router。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { UsageDock } from '@/features/telemetry/usage/UsageDock';
import { createTestQueryClient, mockInvoke } from '@/test/setup.tsx';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// useUsageDock(→ useActiveSession)依赖 router hooks,这里 mock 掉;
// 默认落在 /chat/sess-1 → 活动会话为默认 stub 列表里的 sess-1。
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/chat/sess-1' }),
}));

/** 单会话统计（镜像 SessionStats camelCase 出线,与 UsageView 测试同款）。 */
const STATS = {
  sessionId: 'sess-1',
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

/** 带会话级费用的会话列表（override zhuye_list_sessions）。 */
const COST_SESSIONS = [
  { session_id: 'sess-1', model: 'stub/test', provider: 'local', started_at: '2026-11-20T00:00:00Z', message_count: 2, tool_count: 0, token_total: 0, cwd: '/tmp', display_name: 'First session', title: 'First session', cost_usd: 0.5 },
  { session_id: 'sess-2', model: 'stub/test', provider: 'local', started_at: '2026-11-19T00:00:00Z', message_count: 5, tool_count: 1, token_total: 120, cwd: '/tmp', display_name: 'Second session', title: 'Second session', cost_usd: 1.2 },
  { session_id: 'sess-3', model: 'stub/test', provider: 'local', started_at: '2026-11-18T00:00:00Z', message_count: 1, tool_count: 0, token_total: 0, cwd: '/tmp', display_name: null, title: null, cost_usd: 0.3 },
];

function renderDock() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <UsageDock />
    </QueryClientProvider>,
  );
}

describe('UsageDock', () => {
  beforeEach(() => {
    // useSessions 的三路查询;workspaces 在 setup 默认 stub 里没有,补齐。
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_session_stats', async () => null);
    mockInvoke('zhuye_model_rate_cards', async () => []);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the total tokens with the token split', async () => {
    mockInvoke('zhuye_session_stats', async () => STATS);
    // setup 默认 stub 用的是旧字段 display_name;后端出线是 title,这里对齐。
    mockInvoke('zhuye_list_sessions', async () => [
      { session_id: 'sess-1', model: 'stub/test', provider: 'local', started_at: '2026-11-20T00:00:00Z', message_count: 2, tool_count: 0, token_total: 0, cwd: '/tmp', display_name: 'First session', title: 'First session' },
    ]);

    const { container } = renderDock();

    // 大数字 + 消息数;顶栏子标题 #短id · 会话标题。
    const total = await screen.findByTestId('usage-dock-total');
    expect(total.textContent).toBe('1,200');
    expect(screen.getByTestId('usage-dock-cache-rate').textContent).toContain('25.0%');
    expect(total.parentElement?.textContent).toContain('12 messages');
    expect(screen.getByTestId('usage-dock').textContent).toContain('#sess-1 · First session');

    // 三分段图例:缓存命中 250 / 新输入 750(=1000-250) / 输出 200。
    const body = container.querySelector('[data-testid="usage-dock"]') as HTMLElement;
    expect(body.textContent).toContain('Cache hit');
    expect(body.textContent).toContain('250');
    expect(body.textContent).toContain('750');
    expect(body.textContent).toContain('200');

    // 工具调用统计与压缩节省。
    expect(body.textContent).toContain('Tool calls');
    expect(body.textContent).toContain('7,000');
  });

  it('falls back gracefully when session stats are null', async () => {
    // 磁盘上还没有该会话的 JSONL → zhuye_session_stats 返回 null。
    mockInvoke('zhuye_session_stats', async () => null);

    const { container } = renderDock();

    expect(await screen.findByText('No stats recorded for this session yet.')).toBeDefined();
    // 无 stats → 大数字与工具统计段不渲染,但面板本身与跨会话对比仍在。
    expect(screen.queryByTestId('usage-dock-total')).toBeNull();
    const body = container.querySelector('[data-testid="usage-dock"]') as HTMLElement;
    expect(body.textContent).toContain('Cross-session cost');
    // 默认 stub 会话无费用 → 空态文案。
    expect(body.textContent).toContain('No session costs recorded yet.');
  });

  it('renders cross-session cost rows with the current session highlighted', async () => {
    mockInvoke('zhuye_list_sessions', async () => COST_SESSIONS);

    const { container } = renderDock();

    // 三个会话按费用降序;金额两位小数。
    expect(await screen.findByText('Second session')).toBeDefined();
    const body = container.querySelector('[data-testid="usage-dock"]') as HTMLElement;
    expect(body.textContent).toContain('$1.20');
    expect(body.textContent).toContain('$0.50');
    expect(body.textContent).toContain('$0.30');

    // 当前会话(sess-1, First session)的进度条带 .top 高亮 + data-current。
    const currentRow = body.querySelector('.us-row[data-current="true"]') as HTMLElement | null;
    expect(currentRow).not.toBeNull();
    expect(currentRow!.textContent).toContain('First session');
    expect(currentRow!.querySelector('i.top')).not.toBeNull();
  });

  it('renders model rate cards for the session models', async () => {
    mockInvoke('zhuye_session_stats', async () => STATS);
    mockInvoke('zhuye_model_rate_cards', async () => [
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

    const { container } = renderDock();

    expect(await screen.findByText('Model rate cards')).toBeDefined();
    const body = container.querySelector('[data-testid="usage-dock"]') as HTMLElement;
    expect(body.textContent).toContain('openai/gpt-4o');
    // 每 1M 单价:输入 $3.00 / 输出 $15.00。
    expect(body.textContent).toContain('$3.00');
    expect(body.textContent).toContain('$15.00');
  });

  it('refresh button invalidates usage queries without crashing', async () => {
    mockInvoke('zhuye_session_stats', async () => STATS);

    renderDock();
    const refresh = await screen.findByTestId('usage-dock-refresh');
    expect(() => fireEvent.click(refresh)).not.toThrow();
  });
});
