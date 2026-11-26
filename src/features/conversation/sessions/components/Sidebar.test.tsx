/**
 * Vitest —— Sidebar 组件测试（v3 harness 侧栏）。
 *
 * 会话按工作区分组，可折叠。会话动作集中在
 * 行内 ⋯ 菜单（重命名 / AI 改名 / fork / 导出 / 置顶 / 归档 / 删除）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Sidebar } from '@/features/conversation/sessions/components/Sidebar';
import { ConfirmDialogHost } from '@/features/harness/modals/ConfirmDialog';
import { useShellUi } from '@/stores/shellUi';
import type { WorkspaceSessionGroup } from '@/logic/sessions/workspaceGroups';
import { UNASSIGNED_GROUP_KEY } from '@/logic/sessions/workspaceGroups';

const WS_A = '/Users/me/Code/alpha';
const WS_B = '/Users/me/Code/beta';

function sess(id: string, workspace: string | null, title?: string) {
  return {
    session_id: id,
    model: 'stub/test',
    started_at: new Date().toISOString(),
    message_count: 2,
    ...(title ? { title } : {}),
    ...(workspace === null ? {} : { workspace }),
  };
}

const groupA: WorkspaceSessionGroup = {
  path: WS_A,
  key: WS_A,
  label: 'alpha',
  sessions: [sess('s1', WS_A, 'Fix login bug')],
  lastActivity: Date.now(),
};

const groupB: WorkspaceSessionGroup = {
  path: WS_B,
  key: WS_B,
  label: 'beta',
  sessions: [sess('s2', WS_B)],
  lastActivity: 1,
};

const unassigned: WorkspaceSessionGroup = {
  path: null,
  key: UNASSIGNED_GROUP_KEY,
  label: '',
  sessions: [sess('u1', null)],
  lastActivity: 1,
};

beforeEach(() => {
  localStorage.clear();
  useShellUi.setState({ unread: {} });
});

describe('Sidebar (harness)', () => {
  it('renders empty state when no groups', () => {
    render(
      <Sidebar
        groups={[]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/No sessions yet/)).toBeDefined();
  });

  it('renders loading state', () => {
    render(
      <Sidebar
        groups={[]}
        loading={true}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/Loading/)).toBeDefined();
  });

  it('renders error message', () => {
    render(
      <Sidebar
        groups={[]}
        loading={false}
        error="boom"
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('boom')).toBeDefined();
  });

  it('renders workspace rows and session rows', () => {
    render(
      <Sidebar
        groups={[groupA]}
        loading={false}
        error={null}
        activeId="s1"
        currentWorkspace={WS_A}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    // 工作区行 + 当前工作区高亮（.sel）。
    const wsRow = screen.getByText('alpha').closest('button') as HTMLButtonElement;
    expect(wsRow.getAttribute('class')).toContain('sel');
    expect(wsRow.getAttribute('title')).toBe(WS_A);
    // 会话行渲染 + 活动行高亮。
    const sessRow = screen.getByTestId('harness-session-s1');
    expect(sessRow.textContent).toContain('Fix login bug');
    expect(sessRow.getAttribute('class')).toContain('sel');
  });

  it('renders unassigned workspace row with localized label', () => {
    render(
      <Sidebar
        groups={[unassigned]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const row = screen.getByText('Unassigned');
    // 未归属组默认折叠:分组副本不渲染(「会话」平铺区的权威副本仍可见,
    // 这里只断言分组副本,故用 ws- 前缀 testid)。
    expect(screen.queryByTestId('harness-ws-session-u1')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByTestId('harness-ws-session-u1')).toBeDefined();
  });

  it('collapses workspace sessions and starts a chat with the workspace button', () => {
    const onNewChatIn = vi.fn();
    render(
      <Sidebar
        groups={[groupA, unassigned]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onNewChatIn={onNewChatIn}
      />,
    );
    fireEvent.click(screen.getByText('alpha'));
    // 折叠断言针对分组副本(ws- 前缀);平铺区的权威副本不受折叠影响。
    expect(screen.queryByTestId('harness-ws-session-s1')).toBeNull();
    fireEvent.click(screen.getByTestId(`workspace-new-${groupA.key}`));
    expect(onNewChatIn).toHaveBeenCalledWith(WS_A);
  });

  it('search toggle shows the inline query box and filters sessions', () => {
    render(
      <Sidebar
        groups={[groupA, groupB]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    // 打开内联搜索框并输入。
    fireEvent.click(screen.getByTitle('Search sessions…'));
    const input = screen.getByLabelText('Search sessions');
    fireEvent.change(input, { target: { value: 'Fix login' } });
    // 命中的会话保留，未命中的隐藏。
    expect(screen.getByTestId('harness-session-s1')).toBeDefined();
    expect(screen.queryByTestId('harness-session-s2')).toBeNull();
  });

  it('pendingOnly filter hides sessions without flags', () => {
    render(
      <Sidebar
        groups={[groupA, groupB]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        badges={{ s1: { dot: 'wait', pending: 'plan', unread: false } }}
      />,
    );
    fireEvent.click(screen.getByTestId('harness-pending-only'));
    expect(screen.getByTestId('harness-session-s1')).toBeDefined();
    expect(screen.queryByTestId('harness-session-s2')).toBeNull();
  });

  it('pending badge shows the count chip and the row flag', () => {
    render(
      <Sidebar
        groups={[groupA]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        badges={{ s1: { dot: 'wait', pending: 'plan', unread: false } }}
      />,
    );
    expect(screen.getByTestId('harness-sb-count').textContent).toBe('1');
    const row = screen.getByTestId('harness-session-s1');
    expect(row.getAttribute('class')).toContain('has-pending');
  });

  it('calls onSelect when a session row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <Sidebar
        groups={[groupA]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={onSelect}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('harness-session-s1'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('opens the session menu and archives via the menu action', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <Sidebar
          groups={[groupA]}
          loading={false}
          error={null}
          activeId={null}
          currentWorkspace={null}
          onSelect={vi.fn()}
          onRefresh={vi.fn()}
          onRename={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onExport={vi.fn().mockResolvedValue(null)}
          onArchive={onArchive}
        />
        <ConfirmDialogHost />
      </>,
    );
    fireEvent.click(screen.getByTestId('session-more-s1'));
    const menu = await screen.findByTestId('harness-session-menu');
    expect(menu).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    // 归档经应用内确认框（Tauri WKWebView 无 window.confirm）。
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('s1'));
  });

  it('keeps a session menu inside the viewport near its lower edge', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return { x: 100, y: 740, left: 100, top: 740, right: 120, bottom: 760, width: 20, height: 20, toJSON: () => ({}) };
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    try {
      render(<Sidebar groups={[groupA]} loading={false} error={null} activeId={null}
        currentWorkspace={null} onSelect={vi.fn()} onRefresh={vi.fn()} onRename={vi.fn()} />);
      fireEvent.click(screen.getByTestId('session-more-s1'));
      const menu = screen.getByTestId('harness-session-menu');
      expect(menu.parentElement).toBe(document.body);
      expect(Number.parseFloat(menu.style.top) + 200).toBeLessThanOrEqual(window.innerHeight - 8);
      expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
      fireEvent.scroll(screen.getByTestId('harness-sidebar-scroll'));
      expect(screen.queryByTestId('harness-session-menu')).toBeNull();
    } finally { rect.mockRestore(); width.mockRestore(); height.mockRestore(); }
  });

  it('renames a session inline from its anchored menu', () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<Sidebar groups={[groupA]} loading={false} error={null} activeId={null}
      currentWorkspace={null} onSelect={vi.fn()} onRefresh={vi.fn()} onRename={onRename} />);
    fireEvent.click(screen.getByTestId('session-more-s1'));
    const menu = screen.getByTestId('harness-session-menu');
    expect(menu.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名称' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('s1', '新名称');
  });

  it('delete goes through the in-app confirm dialog', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <Sidebar
          groups={[groupA]}
          loading={false}
          error={null}
          activeId={null}
          currentWorkspace={null}
          onSelect={vi.fn()}
          onRefresh={vi.fn()}
          onRename={vi.fn().mockResolvedValue(undefined)}
          onDelete={onDelete}
          onExport={vi.fn().mockResolvedValue(null)}
        />
        <ConfirmDialogHost />
      </>,
    );
    fireEvent.click(screen.getByTestId('session-more-s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('s1'));
  });

  it('renders the open-project button and invokes the handler', () => {
    const onOpenProject = vi.fn();
    render(
      <Sidebar
        groups={[groupA]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onOpenProject={onOpenProject}
      />,
    );
    fireEvent.click(screen.getByTestId('harness-open-project'));
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });
});
