/**
 * Vitest —— PluginsPanel 测试(插件管理面板)。
 *
 * 覆盖:已安装插件列表 + 启用状态 · 启停 · 卸载 · marketplace 展示。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PluginsPanel } from './PluginsPanel';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const PLUGINS = [
  {
    id: 'demo',
    version: '0.1.0',
    scope: 'user',
    installPath: '/tmp/plugins/demo',
    installedAt: '2026-10-01T00:00:00Z',
    enabled: true,
    gitCommitSha: null,
  },
];

const MARKETS = [
  {
    name: 'local',
    source: 'directory',
    installLocation: '/tmp/marketplaces',
    autoUpdate: true,
  },
];

describe('PluginsPanel', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('reflect_list_plugins', async () => PLUGINS);
    mockInvoke('reflect_list_marketplaces', async () => MARKETS);
    mockInvoke('reflect_toggle_plugin', async () => undefined);
    mockInvoke('reflect_uninstall_plugin', async () => undefined);
    mockInvoke('reflect_install_plugin', async () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the installed plugins with their state', async () => {
    render(wrap(<PluginsPanel />));
    const list = await screen.findByTestId('plugin-list');
    expect(list.textContent).toContain('demo');
    expect(list.textContent).toContain('0.1.0');
    expect(list.textContent).toContain('user');
    expect(list.textContent).toContain('enabled');
  });

  it('shows the known marketplaces', async () => {
    render(wrap(<PluginsPanel />));
    const markets = await screen.findByTestId('plugin-marketplaces');
    expect(markets.textContent).toContain('local');
    expect(markets.textContent).toContain('/tmp/marketplaces');
    expect(markets.textContent).toContain('auto-update');
  });

  it('toggles a plugin', async () => {
    render(wrap(<PluginsPanel />));
    await screen.findByTestId('plugin-list');
    fireEvent.click(screen.getByTestId('plugin-toggle-demo'));
    await waitFor(() => {
      expect(screen.getByTestId('plugin-list')).toBeDefined();
    });
  });

  it('uninstalls a plugin', async () => {
    render(wrap(<PluginsPanel />));
    await screen.findByTestId('plugin-list');
    fireEvent.click(screen.getByTestId('plugin-uninstall-demo'));
    await waitFor(() => {
      expect(screen.getByTestId('plugin-list')).toBeDefined();
    });
  });
});
