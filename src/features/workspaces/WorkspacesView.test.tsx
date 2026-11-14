import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { WorkspacesView } from './WorkspacesView';

afterEach(() => { cleanup(); resetMockInvoke(); });

it('shows history read errors instead of an empty list', async () => {
  mockInvoke('reflect_list_workspaces', async () => { throw new Error('history is corrupt'); });
  render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
  expect(await screen.findByText('Failed to load recent workspaces')).toBeDefined();
  expect(screen.getByText('history is corrupt')).toBeDefined();
});

// ── v1.11 桌面#5:多目录综合工作区(附加目录编辑器) ─────────────────────

import { describe, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';

const CURRENT_DIRS = {
  main: '/tmp/ws-main',
  additional: ['/tmp/ws-extra-a', '/tmp/ws-extra-b'],
};

describe('WorkspacesView — additional dirs editor', () => {
  it('renders additional dir rows and removes one via reflect_set_workspace_dirs', async () => {
    mockInvoke('reflect_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: CURRENT_DIRS.main, degradedReason: null }));
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('reflect_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
      setCalls.push(args);
      return undefined;
    });
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    expect(await screen.findByTestId('workspace-additional-dirs')).toBeDefined();
    // 行随 query resolve 异步出现 —— 必须用 findBy 等待。
    expect(await screen.findByTestId('workspace-additional-ws-extra-a')).toBeDefined();
    expect(screen.getByTestId('workspace-additional-ws-extra-b')).toBeDefined();

    // 移除 a → 反映剩余列表的全量覆盖调用。
    fireEvent.click(screen.getByTestId('workspace-additional-remove-ws-extra-a'));
    await vi.waitFor(() => {
      expect(setCalls).toHaveLength(1);
    });
    expect(setCalls[0]).toEqual({ main: '/tmp/ws-main', additional: ['/tmp/ws-extra-b'] });
  });

  it('shows the empty hint when no additional dirs are configured', async () => {
    mockInvoke('reflect_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: '/tmp/ws-main', degradedReason: null }));
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_current_workspace_dirs', async () => ({ main: '/tmp/ws-main', additional: [] }));
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    expect(await screen.findByText(/No additional folders|尚无附加目录/)).toBeDefined();
  });

  it('remove path still fires the backend call when it rejects (toast renders globally)', async () => {
    mockInvoke('reflect_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: '/tmp/ws-main', degradedReason: null }));
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('reflect_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
      setCalls.push(args);
      throw new Error('dir vanished');
    });
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    fireEvent.click(await screen.findByTestId('workspace-additional-remove-ws-extra-a'));
    await vi.waitFor(() => {
      expect(setCalls).toHaveLength(1);
    });
    expect(setCalls[0].main).toBe('/tmp/ws-main');
  });
});
