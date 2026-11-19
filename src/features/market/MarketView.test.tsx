/**
 * MarketView —— harness 市场页切片测试(mock IPC,走真实 binding + reducer 链)。
 *
 * 覆盖:
 *   - 三源合并渲染:MCP server / 已装插件 + marketplace 清单 / 已装技能
 *   - 过滤 seg 按 kind 筛选 + 空态
 *   - 搜索:本地过滤 + 触发 skills.sh 市场搜索,市场结果可安装
 *   - 动作接线:卸载 MCP / 插件启停 / 插件卸载 / marketplace 安装 / 技能安装
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/utils/i18n';
import { MarketView } from './MarketView';
import { createTestQueryClient, resetMockInvoke, mockInvoke } from '@/test/setup';

// binding 里的返回按钮用 useNavigate;测试无 Router 上下文,替换为 no-op。
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

/** 各命令的调用记录(按命令名分桶,存参数)。 */
const calls: Record<string, unknown[]> = {};

function record(cmd: string, args: unknown): void {
  (calls[cmd] ??= []).push(args);
}

/** 安装默认 mock:三源固定数据 + 突变命令记录参数。 */
function installDefaultMocks() {
  mockInvoke('reflect_list_mcp_servers', async () => [
    { name: 'web-search', transport: 'stdio', command: 'npx', args: ['-y', 'web-mcp'], url: null, running: true },
  ]);
  mockInvoke('reflect_list_plugins', async () => [
    {
      id: 'demo-plugin',
      version: '1.2.0',
      scope: 'user',
      installPath: '/tmp/plugins/demo',
      installedAt: '2026-01-01T00:00:00Z',
      enabled: true,
      runtime: null,
      gitCommitSha: null,
    },
  ]);
  mockInvoke('reflect_list_marketplaces', async () => [
    { name: 'official', source: 'directory', installLocation: '/tmp/marketplaces', autoUpdate: false },
  ]);
  mockInvoke('reflect_browse_marketplace', async () => [
    { name: 'extra-mcp', description: 'Demo plugin from fake marketplace', version: '0.9.0', category: null, tags: ['hook'], source: '{}' },
  ]);
  mockInvoke('reflect_list_skills', async () => [
    { name: 'code-review', description: 'Review code carefully', path: '/skills/code-review', tools: [], triggers: [], version: '2.0.0' },
  ]);
  mockInvoke('reflect_search_skill_market', async (_cmd: string, args: { query: string }) => {
    record('reflect_search_skill_market', args);
    return [{ id: 'owner/repo/summarize', source: 'owner/repo', slug: 'summarize', official: true }];
  });

  mockInvoke('reflect_delete_mcp_server', async (_cmd: string, args: unknown) => {
    record('reflect_delete_mcp_server', args);
  });
  mockInvoke('reflect_toggle_plugin', async (_cmd: string, args: unknown) => {
    record('reflect_toggle_plugin', args);
  });
  mockInvoke('reflect_uninstall_plugin', async (_cmd: string, args: unknown) => {
    record('reflect_uninstall_plugin', args);
  });
  mockInvoke('reflect_install_from_marketplace', async (_cmd: string, args: unknown) => {
    record('reflect_install_from_marketplace', args);
  });
  mockInvoke('reflect_install_skill_from_market', async (_cmd: string, args: unknown) => {
    record('reflect_install_skill_from_market', args);
    return 'sub-fake';
  });
}

function QueryWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function renderView() {
  return render(
    <QueryWrapper>
      <I18nProvider>
        <MarketView />
      </I18nProvider>
    </QueryWrapper>,
  );
}

describe('MarketView', () => {
  beforeEach(() => {
    cleanup();
    for (const key of Object.keys(calls)) delete calls[key];
    resetMockInvoke();
    installDefaultMocks();
  });

  it('merges cards from MCP / plugins / skills into one grid', async () => {
    renderView();
    // marketplace 清单是独立查询,等最慢的卡片出现后再统一断言。
    await waitFor(() => expect(screen.getByTestId('market-card-market:official:extra-mcp')).toBeDefined());
    expect(screen.getByTestId('market-card-mcp:web-search')).toBeDefined();
    expect(screen.getByTestId('market-card-plugin:demo-plugin')).toBeDefined();
    expect(screen.getByTestId('market-card-skill:code-review')).toBeDefined();

    // 已安装徽标:已装来源出现,marketplace 条目不出现。
    expect(screen.getAllByText('Installed').length).toBe(3);

    // 头部副标题:已安装 3 · 可用 1。
    await waitFor(() =>
      expect(screen.getByTestId('market-view').textContent).toContain('3 installed · 1 available'),
    );
  });

  it('filter seg narrows cards by kind', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('market-card-market:official:extra-mcp')).toBeDefined());

    fireEvent.click(screen.getByTestId('market-filter-mcp'));
    // 插件缺省映射为 mcp(无类型字段),与 MCP server 同档。
    expect(screen.getByTestId('market-card-mcp:web-search')).toBeDefined();
    expect(screen.getByTestId('market-card-plugin:demo-plugin')).toBeDefined();
    expect(screen.queryByTestId('market-card-skill:code-review')).toBeNull();
    expect(screen.queryByTestId('market-card-market:official:extra-mcp')).toBeNull();

    fireEvent.click(screen.getByTestId('market-filter-skill'));
    expect(screen.getByTestId('market-card-skill:code-review')).toBeDefined();
    expect(screen.queryByTestId('market-card-mcp:web-search')).toBeNull();

    fireEvent.click(screen.getByTestId('market-filter-hook'));
    expect(screen.getByTestId('market-card-market:official:extra-mcp')).toBeDefined();
    expect(screen.queryByTestId('market-card-mcp:web-search')).toBeNull();

    fireEvent.click(screen.getByTestId('market-filter-all'));
    await waitFor(() => expect(screen.getByTestId('market-card-mcp:web-search')).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('market-card-market:official:extra-mcp')).toBeDefined());
  });

  it('search filters locally and triggers the skill market search', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('market-card-mcp:web-search')).toBeDefined());

    fireEvent.change(screen.getByTestId('market-search'), { target: { value: 'code' } });

    // 本地过滤:只剩名称命中 'code' 的技能卡。
    await waitFor(() => expect(screen.queryByTestId('market-card-mcp:web-search')).toBeNull());
    expect(screen.getByTestId('market-card-skill:code-review')).toBeDefined();

    // 同时触发 skills.sh 市场搜索(≥2 字符),市场结果进网格。
    await waitFor(() => expect(calls.reflect_search_skill_market?.length).toBeGreaterThanOrEqual(1));
    expect((calls.reflect_search_skill_market[0] as { query: string }).query).toBe('code');
    await waitFor(() => expect(screen.getByTestId('market-card-skmarket:owner/repo/summarize')).toBeDefined());
  });

  it('market skill entry installs via reflect_install_skill_from_market', async () => {
    renderView();
    fireEvent.change(screen.getByTestId('market-search'), { target: { value: 'summarize' } });
    const installBtn = await screen.findByTestId('market-action-skmarket:owner/repo/summarize');
    fireEvent.click(installBtn);
    await waitFor(() =>
      expect(calls.reflect_install_skill_from_market?.[0]).toEqual({ source: 'owner/repo/summarize' }),
    );
  });

  it('uninstalling an MCP card wires reflect_delete_mcp_server', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('market-action-mcp:web-search'));
    await waitFor(() => expect(calls.reflect_delete_mcp_server?.[0]).toEqual({ name: 'web-search' }));
  });

  it('installed plugin toggles enable/disable and uninstalls with its scope', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('market-card-plugin:demo-plugin')).toBeDefined());

    // 已启用的插件:主按钮 = 停用;副按钮 = 卸载。
    fireEvent.click(screen.getByTestId('market-action-plugin:demo-plugin'));
    await waitFor(() =>
      expect(calls.reflect_toggle_plugin?.[0]).toEqual({ id: 'demo-plugin', enabled: false }),
    );

    fireEvent.click(screen.getByTestId('market-action-plugin:demo-plugin-uninstall'));
    await waitFor(() =>
      expect(calls.reflect_uninstall_plugin?.[0]).toEqual({ id: 'demo-plugin', scope: 'user' }),
    );
  });

  it('marketplace entry installs via reflect_install_from_marketplace', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('market-action-market:official:extra-mcp'));
    await waitFor(() =>
      expect(calls.reflect_install_from_marketplace?.[0]).toEqual({ marketplace: 'official', plugin: 'extra-mcp' }),
    );
  });

  it('installed skill card is read-only (no uninstall command exists)', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('market-card-skill:code-review')).toBeDefined());
    expect(screen.queryByTestId('market-action-skill:code-review')).toBeNull();
    expect(screen.queryByTestId('market-action-skill:code-review-uninstall')).toBeNull();
  });
});
