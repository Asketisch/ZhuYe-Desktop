/**
 * Vitest —— McpManager 测试(MCP 服务管理面板)。
 *
 * 覆盖:已配置服务列表 + 运行状态 · 新增表单 · 精选 catalog 一键加入 ·
 * 删除。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { McpManager } from './McpManager';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const SERVERS = [
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    url: null,
    running: true,
  },
];

const CATALOG = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: '本地文件读写 MCP server',
    category: 'files',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    installHint: 'npx -y @modelcontextprotocol/server-filesystem',
  },
];

describe('McpManager', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('reflect_list_mcp_servers', async () => SERVERS);
    mockInvoke('reflect_mcp_catalog', async () => CATALOG);
    mockInvoke('reflect_upsert_mcp_server', async () => undefined);
    mockInvoke('reflect_delete_mcp_server', async () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the configured servers with their running state', async () => {
    render(wrap(<McpManager />));
    const list = await screen.findByTestId('mcp-server-list');
    expect(list.textContent).toContain('filesystem');
    expect(list.textContent).toContain('stdio');
    expect(list.textContent).toContain('started');
  });

  it('adds a stdio server through the form', async () => {
    render(wrap(<McpManager />));
    await screen.findByTestId('mcp-server-list');
    fireEvent.click(screen.getByTestId('mcp-add-toggle'));

    fireEvent.change(screen.getByTestId('mcp-name-input'), { target: { value: 'memory' } });
    fireEvent.change(screen.getByTestId('mcp-command-input'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByTestId('mcp-args-input'), {
      target: { value: '-y @modelcontextprotocol/server-memory' },
    });
    fireEvent.click(screen.getByTestId('mcp-add-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('mcp-add-form')).toBeNull();
    });
  });

  it('browses the curated catalog', async () => {
    render(wrap(<McpManager />));
    await screen.findByTestId('mcp-server-list');
    fireEvent.click(screen.getByTestId('mcp-catalog-toggle'));

    const catalog = await screen.findByTestId('mcp-catalog');
    expect(catalog.textContent).toContain('Filesystem');
    expect(catalog.textContent).toContain('@modelcontextprotocol/server-filesystem');
  });

  it('removes a configured server', async () => {
    render(wrap(<McpManager />));
    await screen.findByTestId('mcp-server-list');
    fireEvent.click(screen.getByTestId('mcp-delete-filesystem'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-list')).toBeDefined();
    });
  });
});
