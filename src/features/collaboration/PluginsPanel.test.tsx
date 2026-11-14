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
    // v1.11 桌面#2:插件市场(浏览 + 一键安装)。
    mockInvoke('reflect_browse_marketplace', async () => [
      {
        name: 'demo',
        description: 'Demo plugin from fake marketplace',
        version: '0.1.0',
        category: null,
        tags: ['demo'],
        source: '{"type":"directory","path":"/tmp/marketplaces/demo"}',
      },
    ]);
    mockInvoke('reflect_install_from_marketplace', async () => undefined);
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

  it('shows an uninstall error and refreshes state after a partial failure', async () => {
    let installed = true;
    mockInvoke('reflect_list_plugins', async () => installed ? PLUGINS : []);
    mockInvoke('reflect_uninstall_plugin', async () => {
      installed = false;
      throw { msg: 'runtime refresh failed after uninstall' };
    });
    render(wrap(<PluginsPanel />));
    await screen.findByTestId('plugin-list');
    fireEvent.click(screen.getByTestId('plugin-uninstall-demo'));
    expect((await screen.findByTestId('plugin-action-error')).textContent)
      .toContain('runtime refresh failed after uninstall');
    await waitFor(() => expect(screen.queryByTestId('plugin-list')).toBeNull());
  });

  it('shows string errors when plugin installation fails', async () => {
    mockInvoke('reflect_install_plugin', async () => { throw 'invalid plugin'; });
    render(wrap(<PluginsPanel />));
    fireEvent.click(screen.getByTestId('plugin-install-toggle'));
    fireEvent.change(screen.getByTestId('plugin-path-input'), { target: { value: '/tmp/plugin' } });
    fireEvent.click(screen.getByTestId('plugin-install-submit'));
    expect((await screen.findByTestId('plugin-install-error')).textContent).toContain('invalid plugin');
  });

  it('shows plugin list failures instead of an empty list', async () => {
    mockInvoke('reflect_list_plugins', async () => { throw { msg: 'cannot read plugins' }; });
    render(wrap(<PluginsPanel />));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot read plugins');
    expect(screen.queryByTestId('plugin-list')).toBeNull();
  });

  it('shows only plugins currently loaded and removes them after disabling', async () => {
    let enabled = true;
    mockInvoke('reflect_list_plugins', async () => [{
      ...PLUGINS[0], enabled,
      runtime: enabled ? { plugin: 'demo', scope: 'user', version: '0.1.0', skill_count: 1, command_count: 2 } : null,
    }]);
    mockInvoke('reflect_toggle_plugin', async () => { enabled = false; });
    render(wrap(<PluginsPanel />));
    expect((await screen.findByTestId('plugin-loaded-list')).textContent).toContain('2 cmds');
    fireEvent.click(screen.getByTestId('plugin-toggle-demo'));
    await waitFor(() => expect(screen.queryByTestId('plugin-loaded-list')).toBeNull());
  });
});


// ── v1.11 桌面#2:插件市场(浏览 + 一键安装) ────────────────────────────

describe('PluginsPanel — marketplace browse & install', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('reflect_list_plugins', async () => PLUGINS);
    mockInvoke('reflect_list_marketplaces', async () => MARKETS);
    mockInvoke('reflect_browse_marketplace', async () => [
      {
        name: 'demo',
        description: 'Demo plugin from fake marketplace',
        version: '0.1.0',
        category: null,
        tags: ['demo'],
        source: '{}',
      },
    ]);
    mockInvoke('reflect_install_from_marketplace', async () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('expands a marketplace and lists its installable plugins', async () => {
    render(wrap(<PluginsPanel />));
    fireEvent.click(await screen.findByTestId('marketplace-browse-local'));
    // 行随 browse query resolve 异步出现 —— 等行元素而非容器。
    const row = await screen.findByTestId('market-plugin-demo');
    expect(row.textContent).toContain('demo');
    expect(row.textContent).toContain('0.1.0');
  });

  it('installs a plugin from the marketplace listing', async () => {
    const installCalls: Array<{ marketplace: string; plugin: string }> = [];
    mockInvoke('reflect_install_from_marketplace', async (_cmd: string, args: { marketplace: string; plugin: string }) => {
      installCalls.push(args);
      return undefined;
    });
    render(wrap(<PluginsPanel />));
    fireEvent.click(await screen.findByTestId('marketplace-browse-local'));
    fireEvent.click(await screen.findByTestId('market-install-demo'));
    await vi.waitFor(() => {
      expect(installCalls).toEqual([{ marketplace: 'local', plugin: 'demo' }]);
    });
  });

  it('surfaces install failures inline', async () => {
    mockInvoke('reflect_install_from_marketplace', async () => {
      throw new Error('dep resolution failed');
    });
    render(wrap(<PluginsPanel />));
    fireEvent.click(await screen.findByTestId('marketplace-browse-local'));
    fireEvent.click(await screen.findByTestId('market-install-demo'));
    expect(await screen.findByTestId('market-install-error')).toBeDefined();
    expect(screen.getByTestId('market-install-error').textContent).toContain('dep resolution failed');
  });

  it('shows an inline error when the marketplace cache is missing', async () => {
    mockInvoke('reflect_browse_marketplace', async () => {
      throw new Error('marketplace manifest not found');
    });
    render(wrap(<PluginsPanel />));
    fireEvent.click(await screen.findByTestId('marketplace-browse-local'));
    expect(await screen.findByText(/manifest not found/)).toBeDefined();
  });
});
