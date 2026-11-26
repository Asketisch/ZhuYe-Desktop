import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { WorkspacesView } from './WorkspacesView';
import { ConfirmDialogHost } from '@/features/harness/modals/ConfirmDialog';

afterEach(() => { cleanup(); resetMockInvoke(); });

it('shows history read errors instead of an empty list', async () => {
  mockInvoke('zhuye_list_workspaces', async () => { throw new Error('history is corrupt'); });
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
  it('renders additional dir rows and removes one via zhuye_set_workspace_dirs', async () => {
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: CURRENT_DIRS.main, degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('zhuye_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
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
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: '/tmp/ws-main', degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_current_workspace_dirs', async () => ({ main: '/tmp/ws-main', additional: [] }));
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    expect(await screen.findByText(/No additional folders|尚无附加目录/)).toBeDefined();
  });

  it('remove path still fires the backend call when it rejects (toast renders globally)', async () => {
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: '/tmp/ws-main', degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('zhuye_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
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

  // ── 增目录输入流:目录选择器 → 追加到既有附加目录集合(全量覆盖) ──

  it('adding a picked folder appends it via zhuye_set_workspace_dirs', async () => {
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: CURRENT_DIRS.main, degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('zhuye_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
      setCalls.push(args);
      return undefined;
    });
    // 目录选择器返回新目录。
    mockInvoke('zhuye_pick_workspace_folder', async () => '/tmp/ws-extra-c');
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    // 等附加目录行出现(query 已 resolve)再点添加,否则读到空快照。
    await screen.findByTestId('workspace-additional-ws-extra-a');
    fireEvent.click(screen.getByTestId('workspaces-additional-add'));
    await vi.waitFor(() => {
      expect(setCalls).toHaveLength(1);
    });
    // 追加语义:既有附加目录保留,新目录殿后。
    expect(setCalls[0]).toEqual({
      main: '/tmp/ws-main',
      additional: ['/tmp/ws-extra-a', '/tmp/ws-extra-b', '/tmp/ws-extra-c'],
    });
  });

  it('picking a duplicate fires no set call (idempotent no-op)', async () => {
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: CURRENT_DIRS.main, degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_current_workspace_dirs', async () => CURRENT_DIRS);
    const setCalls: Array<{ main: string; additional: string[] }> = [];
    mockInvoke('zhuye_set_workspace_dirs', async (_cmd: string, args: { main: string; additional: string[] }) => {
      setCalls.push(args);
      return undefined;
    });
    // 已在附加集合里的目录。
    mockInvoke('zhuye_pick_workspace_folder', async () => '/tmp/ws-extra-a');
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    // 等附加目录行出现(query 已 resolve)再点添加,否则读到空快照。
    await screen.findByTestId('workspace-additional-ws-extra-a');
    fireEvent.click(screen.getByTestId('workspaces-additional-add'));
    // 静默幂等:短暂窗口内不应产生覆盖调用。
    await new Promise((r) => setTimeout(r, 60));
    expect(setCalls).toHaveLength(0);
  });
});

// ── v1.x:移除(软删除)入口 + 已移除分区恢复 ──────────────────────────

describe('WorkspacesView — remove & restore', () => {
  const WS = { path: '/tmp/proj-a', label: 'proj-a', last_used: 10, session_count: 0, hidden: false };
  const REMOVED = { path: '/tmp/proj-b', label: 'proj-b', last_used: 5, session_count: 0, hidden: true };

  const setup = () => {
    // 当前工作区设为第三个路径,保证 proj-a 卡片非激活(移除按钮仅在非激活卡上)。
    mockInvoke('zhuye_agent_status', async () => ({ ready: true, hasModel: true, model: 'm', workspace: '/tmp/elsewhere', degradedReason: null }));
    mockInvoke('zhuye_list_workspaces', async () => [WS, REMOVED]);
    const setCalls: Array<{ path: string; unhide: boolean | null }> = [];
    const removeCalls: Array<{ path: string }> = [];
    mockInvoke('zhuye_set_workspace', async (_c: string, args: { path: string; unhide?: boolean | null }) => {
      setCalls.push({ path: args.path, unhide: args.unhide ?? null });
      return undefined;
    });
    mockInvoke('zhuye_remove_workspace', async (_c: string, args: { path: string }) => {
      removeCalls.push(args);
      return undefined;
    });
    return { setCalls, removeCalls };
  };

  it('lists removed workspaces in a dedicated section and restores with unhide', async () => {
    const { setCalls } = setup();
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
    // 已移除分区出现,恢复按钮走 set_workspace + unhide:true。
    fireEvent.click(await screen.findByTestId('workspace-restore-proj-b'));
    await vi.waitFor(() => {
      expect(setCalls).toContainEqual({ path: '/tmp/proj-b', unhide: true });
    });
  });

  it('visible card remove button asks for confirmation then fires zhuye_remove_workspace', async () => {
    const { removeCalls } = setup();
    render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /><ConfirmDialogHost /></QueryClientProvider>);
    fireEvent.click(await screen.findByTestId('workspace-remove-proj-a'));
    // 确认弹窗出现,点确认后才真正移除。
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await vi.waitFor(() => {
      expect(removeCalls).toEqual([{ path: '/tmp/proj-a' }]);
    });
  });
});
