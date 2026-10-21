/**
 * Vitest — TracesView 测试。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TracesView } from '@/features/traces/TracesView';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const SESSION = {
  sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Demo chat',
  calls: 2,
  lastAt: '2026-10-01T00:00:01Z',
  model: 'glm-4.7',
  lastSource: 'main_turn',
};

const CALLS = [
  {
    startedAt: '2026-10-01T00:00:00Z',
    completedAt: '2026-10-01T00:00:01Z',
    durationMs: 1000,
    attempt: 1,
    requestId: 'r1',
    traceId: 't1',
    turnId: null,
    querySource: 'main_turn',
    model: { modelId: 'glm-4.7', providerId: 'zhipu', role: null, source: 'main_turn' },
    request: { message_count: 2 },
    response: { finish_reason: 'stop' },
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 150,
    },
  },
];

describe('TracesView', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no traces exist', async () => {
    mockInvoke('reflect_list_traces', async () => []);
    render(wrap(<TracesView />));
    expect(await screen.findByText(/No traces yet/i)).toBeDefined();
  });

  it('renders session list and loads call details on select', async () => {
    mockInvoke('reflect_list_traces', async () => [SESSION]);
    mockInvoke('reflect_get_trace', async () => CALLS);

    render(wrap(<TracesView />));
    expect(await screen.findByTestId('traces-session-list')).toBeDefined();
    expect(await screen.findByText('Demo chat')).toBeDefined();

    fireEvent.click(screen.getByText('Demo chat'));
    expect(await screen.findByTestId('traces-detail-header')).toBeDefined();
    expect(await screen.findByText('#1')).toBeDefined();
    // 模型 id 同时出现在 session 摘要与调用详情,取全部匹配断言存在即可。
    expect(screen.getAllByText('glm-4.7').length).toBeGreaterThan(0);
    expect(screen.getByText('1000ms')).toBeDefined();
  });

  it('surfaces list errors without crashing', async () => {
    mockInvoke('reflect_list_traces', async () => {
      throw new Error('traces dir unreadable');
    });
    render(wrap(<TracesView />));
    expect(await screen.findByText(/traces dir unreadable/i)).toBeDefined();
  });
});
