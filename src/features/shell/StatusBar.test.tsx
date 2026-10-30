/**
 * StatusBar —— token/cost 显示测试。
 *
 * 验证：
 *   - tokens === null 时不渲染 token 指示器
 *   - tokens 有值时显示 total + cost
 *   - cost === null 时只显示 total,不含 "$"
 *
 * 仿 AppShell.test.tsx 模式：QueryClient 包裹 + resetMockInvoke + store.setState。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from '@/features/shell/StatusBar';
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

describe('StatusBar — token indicator', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('does not render token indicator when tokens is null', () => {
    useAgentStore.setState({ tokens: null });
    render(wrap(<StatusBar />));
    expect(screen.queryByTestId('statusbar-tokens')).toBeNull();
  });

  it('renders total without any cost fragment when tokens present', () => {
    const tokens: TokenSnapshot = {
      input: 1200,
      output: 300,
      cached: 200,
      cacheWrite: 500,
      total: 1500,
      cost: null,
      sessionCost: 0,
    };
    useAgentStore.setState({ tokens });
    render(wrap(<StatusBar />));
    const el = screen.getByTestId('statusbar-tokens');
    const text = el.textContent ?? '';
    expect(text).toContain('1,500'); // total
    expect(text).not.toContain('$');
  });

  it('renders total only when cost is null', () => {
    const tokens: TokenSnapshot = {
      input: 10,
      output: 5,
      cached: 0,
      cacheWrite: 0,
      total: 15,
      cost: null,
      sessionCost: 0,
    };
    useAgentStore.setState({ tokens });
    render(wrap(<StatusBar />));
    const el = screen.getByTestId('statusbar-tokens');
    const text = el.textContent ?? '';
    expect(text).toContain('15');
    expect(text).not.toContain('$');
  });

  it('renders cumulative session cost element when sessionCost > 0', () => {
    const tokens: TokenSnapshot = {
      input: 10,
      output: 5,
      cached: 0,
      cacheWrite: 0,
      total: 15,
      cost: 0.0021,
      sessionCost: 0.0357,
    };
    useAgentStore.setState({ tokens });
    render(wrap(<StatusBar />));
    // 累计费用徽标出现且显示美元金额(4 位小数保留小额精度)。
    const cost = screen.getByTestId('statusbar-cost');
    expect(cost.textContent).toContain('$0.0357');
    // tooltip 含最近一次费用与累计费用两行。
    const tokensEl = screen.getByTestId('statusbar-tokens');
    expect(tokensEl).toBeTruthy();
  });

  it('hides cost element for unpriced models (cost null, sessionCost 0)', () => {
    const tokens: TokenSnapshot = {
      input: 10,
      output: 5,
      cached: 0,
      cacheWrite: 0,
      total: 15,
      cost: null,
      sessionCost: 0,
    };
    useAgentStore.setState({ tokens });
    render(wrap(<StatusBar />));
    expect(screen.queryByTestId('statusbar-cost')).toBeNull();
  });
});

describe('StatusBar — 模型降级状态', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('有可用模型但重载失败时显示警告', async () => {
    mockInvoke('reflect_agent_status', async () => ({
      ready: true, has_model: true, model: 'openai/old-model',
      workspace: '/tmp', degraded_reason: 'session rebind failed',
    }));
    useAgentStore.setState({ session: { model: 'old-model', provider: 'openai' } });
    render(wrap(<StatusBar />));
    const model = await screen.findByText('old-model @ openai');
    await waitFor(() => expect(model.getAttribute('title')).toBe('session rebind failed'));
    expect(model.querySelector('[data-kind="warn"]')).not.toBeNull();
  });
});

// ===========================================================================
// OS 沙箱徽标 —— 报的是「真正生效」的状态
// ===========================================================================

describe('StatusBar — OS 沙箱徽标', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('显示有效状态(而非配置值)', async () => {
    mockInvoke('reflect_sandbox_status', async () => ({
      osLevel: true,
      status: 'seatbelt',
      active: true,
      backend: 'seatbelt',
      statusLine: 'os-sandbox: seatbelt 已启用',
      enabled: true,
      envOverride: null,
    }));
    render(wrap(<StatusBar />));
    await waitFor(() => {
      expect(screen.getByTestId('statusbar-sandbox').textContent).toContain('seatbelt');
    });
  });

  it('沙箱被关闭时徽标显示 disabled', async () => {
    mockInvoke('reflect_sandbox_status', async () => ({
      osLevel: false,
      status: 'disabled',
      active: false,
      backend: 'seatbelt',
      statusLine: 'os-sandbox: 未启用',
      enabled: false,
      envOverride: null,
    }));
    render(wrap(<StatusBar />));
    await waitFor(() => {
      expect(screen.getByTestId('statusbar-sandbox').textContent).toContain('disabled');
    });
    expect(screen.getByTestId('statusbar-sandbox').getAttribute('data-active')).toBeNull();
  });

  it('env 覆盖生效时在 tooltip 里标注(否则用户在设置里拨开关看不到变化会困惑)', async () => {
    mockInvoke('reflect_sandbox_status', async () => ({
      osLevel: true,
      status: 'disabled',
      active: false,
      backend: 'seatbelt',
      statusLine: 'os-sandbox: 未启用',
      enabled: false,
      envOverride: '0',
    }));
    render(wrap(<StatusBar />));
    await waitFor(() => {
      expect(screen.getByTestId('statusbar-sandbox')).toBeTruthy();
    });
    const sandbox = screen.getByTestId('statusbar-sandbox');
    // tooltip 是该徽标的兄弟节点(Tooltip 纯 CSS,label 常驻 DOM)。
    expect(sandbox.parentElement?.textContent).toContain('ZHUYE_SANDBOX_OS_LEVEL=0');
  });
});
