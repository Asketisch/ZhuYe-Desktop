/**
 * Vitest — NotificationsView 测试（过滤逻辑 + 计数）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NotificationsView } from '@/features/telemetry/notifications/NotificationsView';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke, createTestQueryClient } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('NotificationsView', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(() => cleanup());

  it('shows empty state when nothing pending', () => {
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/No notifications/i)).toBeDefined();
  });

  it('renders error notification from lastError', () => {
    useAgentStore.setState({ lastError: 'boom from backend' });
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/boom from backend/)).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('renders approval/question/input pending items', () => {
    useAgentStore.setState({
      pendingApprovals: [{ id: 'a1', kind: 'tool', toolName: 'bash', turnId: 't1' }],
      pendingQuestions: [{ id: 'q1', payload: { questions: [] }, turnId: 't1' }],
      pendingAskUser: [{ id: 'u1', payload: { prompt: '?' }, turnId: 't1' }],
    });
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/Tool Approval pending/i)).toBeDefined();
    expect(screen.getByText(/Question pending/i)).toBeDefined();
    expect(screen.getByText(/Input pending/i)).toBeDefined();
  });

  it('renders MCP/LSP server rows', () => {
    useAgentStore.setState({
      mcpServers: [{ name: 'fs', status: 'started' }],
      lspServers: [{ name: 'rust', status: 'failed', detail: 'missing binary' }],
    });
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/MCP server fs started/)).toBeDefined();
    expect(screen.getByText(/LSP server rust failed/)).toBeDefined();
  });

  it('renders plan pending notification', () => {
    useAgentStore.setState({ pendingPlan: { id: 'p1', payload: {}, turnId: 't1' } });
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/Plan pending/i)).toBeDefined();
  });

  it('filter buttons switch visible items (Errors only)', () => {
    useAgentStore.setState({
      lastError: 'error msg',
      pendingApprovals: [{ id: 'a1', kind: 'tool', turnId: 't1' }],
    });
    render(wrap(<NotificationsView />));
    expect(screen.getByText(/error msg/)).toBeDefined();
    expect(screen.getByText(/approval pending/i)).toBeDefined();

    fireEvent.click(screen.getByText(/^Errors/));
    // 错误仍在，approval 隐藏（warn 级）。
    expect(screen.getByText(/error msg/)).toBeDefined();
    expect(screen.queryByText(/approval pending/i)).toBeNull();
  });

  it('filter buttons switch to Pending only', () => {
    useAgentStore.setState({
      lastError: 'error msg',
      pendingApprovals: [{ id: 'a1', kind: 'tool', turnId: 't1' }],
    });
    render(wrap(<NotificationsView />));
    fireEvent.click(screen.getByText(/^Pending/));
    expect(screen.queryByText(/error msg/)).toBeNull();
    expect(screen.getByText(/approval pending/i)).toBeDefined();
  });

  it('dismiss error button clears lastError', () => {
    useAgentStore.setState({ lastError: 'oops' });
    render(wrap(<NotificationsView />));
    fireEvent.click(screen.getByText('Dismiss error'));
    expect(useAgentStore.getState().lastError).toBeNull();
  });
});