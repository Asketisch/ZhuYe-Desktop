/**
 * AppShell 折叠行为测试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/features/shell/AppShell';
import { useAgentStore } from '@/stores/agentStore';
import { resetMockInvoke, mockInvoke, createTestQueryClient } from '@/test/setup.tsx';
import { isPinned, togglePin, unpin } from '@/features/sessions/utils/pins';

const navigate = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ pathname: '/' }));

// Mock @tanstack/react-router — 仿照 app.smoke.test.tsx 的 mock 模式。
// Outlet 渲染一个 sentinel，验证 AppShell 真的把 router children 挂到了 DOM
// （历史 bug：用 children prop 而不是 <Outlet />，导致主区域永久空白）。
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return {
    ...actual,
    Link: ({
      children,
      to,
      onClick,
      style,
      params: _params,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
      onClick?: () => void;
      style?: React.CSSProperties;
      params?: Record<string, unknown>;
      [k: string]: unknown;
    }) => (
      <a href={typeof to === 'string' ? to.replace(/\$/g, String(_params?.sessionId ?? '')) : '#'} onClick={onClick} style={style} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => navigate,
    useRouter: () => ({ navigate: vi.fn() }),
    useLocation: () => route,
    useMatches: () => [],
    Outlet: () => <div data-testid="outlet-content">outlet</div>,
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('AppShell collapse behavior', () => {
  beforeEach(() => {
    resetMockInvoke();
    navigate.mockClear();
    route.pathname = '/';
    useAgentStore.getState().reset();
  });
  afterEach(() => { cleanup(); unpin('clear-active'); });

  it('initial: sidebar visible, inspector hidden', () => {
    render(wrap(<AppShell />));
    expect(screen.getByTestId('shell-sidebar')).toBeDefined();
    expect(screen.queryByTestId('shell-inspector')).toBeNull();
  });

  it('clicking sidebar toggle button removes sidebar from DOM', () => {
    render(wrap(<AppShell />));
    expect(screen.getByTestId('shell-sidebar')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Hide sidebar'));
    expect(screen.queryByTestId('shell-sidebar')).toBeNull();
  });

  it('clicking sidebar toggle twice round-trips (open → close → open)', () => {
    render(wrap(<AppShell />));
    const hideBtn = screen.getByLabelText('Hide sidebar');
    fireEvent.click(hideBtn);
    expect(screen.queryByTestId('shell-sidebar')).toBeNull();
    // 第一次折叠后，按钮 label 变回 "Show sidebar"
    fireEvent.click(screen.getByLabelText('Show sidebar'));
    expect(screen.getByTestId('shell-sidebar')).toBeDefined();
  });

  it('clicking inspector toggle adds inspector to DOM', () => {
    render(wrap(<AppShell />));
    expect(screen.queryByTestId('shell-inspector')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inspector'));
    expect(screen.getByTestId('shell-inspector')).toBeDefined();
  });

  it('both panels can be collapsed simultaneously', () => {
    render(wrap(<AppShell />));
    fireEvent.click(screen.getByLabelText('Hide sidebar'));
    fireEvent.click(screen.getByLabelText('Show inspector'));
    fireEvent.click(screen.getByLabelText('Hide inspector'));
    expect(screen.queryByTestId('shell-sidebar')).toBeNull();
    expect(screen.queryByTestId('shell-inspector')).toBeNull();
  });

  // 回归保护：AppShell 必须渲染 <Outlet />（不是 children prop），
  // 否则 TanStack Router 解析的子路由全部不显示 —— 主区域永久空白。
  it('renders Outlet content (router children actually mount)', () => {
    render(wrap(<AppShell />));
    expect(screen.getByTestId('outlet-content')).toBeDefined();
  });

  // v1.x workspace→session 归属：New Chat 主动分配 session id(纯 ID 分配,
  // session 在首条 submission 时后端物化), 再 setActiveId 导航到 /chat/$id。
  it('New Chat calls reflect_create_session before navigating', async () => {
    const created: unknown[] = [];
    mockInvoke('reflect_create_session', async () => {
      created.push('sess-new-1');
      return 'sess-new-1';
    });
    mockInvoke('reflect_list_sessions', async () => []);
    mockInvoke('reflect_current_workspace', async () => null);

    render(wrap(<AppShell />));
    fireEvent.click(screen.getByRole('button', { name: /^new chat$/i }));

    await new Promise((r) => setTimeout(r, 0)); // 让 .then(setActiveId) 微任务落地
    expect(created).toEqual(['sess-new-1']);
  });

  it('restores the later session workspace after an earlier switch completes', async () => {
    mockInvoke('reflect_current_workspace', async () => '/second');
    mockInvoke('reflect_list_sessions', async () => [
      { session_id: 'first', title: 'First session', workspace: '/first', model: '', started_at: new Date().toISOString(), message_count: 1 },
      { session_id: 'second', title: 'Second session', workspace: '/second', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('reflect_list_workspaces', async () => []);
    const calls: string[] = [];
    let finish!: () => void;
    mockInvoke('reflect_set_workspace', async (_command, args) => {
      const path = (args as { path: string }).path;
      calls.push(path);
      if (path === '/first') await new Promise<void>((resolve) => { finish = resolve; });
    });
    render(wrap(<AppShell />));
    const first = await screen.findByRole('button', { name: /First session/ });
    const second = await screen.findByRole('button', { name: /Second session/ });
    fireEvent.click(first);
    await waitFor(() => expect(calls).toEqual(['/first']));
    fireEvent.click(second);
    expect(calls).toEqual(['/first']);
    finish();
    await waitFor(() => expect(calls).toEqual(['/first', '/second']));
  });

  it('does not open a session when its workspace cannot be selected', async () => {
    mockInvoke('reflect_current_workspace', async () => '/current');
    mockInvoke('reflect_list_sessions', async () => [
      { session_id: 'missing', title: 'Missing project session', workspace: '/missing', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_set_workspace', async () => { throw new Error('directory not found'); });
    render(wrap(<AppShell />));
    fireEvent.click(await screen.findByRole('button', { name: /Missing project session/ }));
    await screen.findByText(/directory not found/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate to a newly created session after selecting another session', async () => {
    mockInvoke('reflect_current_workspace', async () => '/current');
    mockInvoke('reflect_list_sessions', async () => [
      { session_id: 'chosen', title: 'Chosen session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_set_workspace', async () => {});
    let finish!: (id: string) => void;
    mockInvoke('reflect_create_session', () => new Promise<string>((resolve) => { finish = resolve; }));
    render(wrap(<AppShell />));
    const chosen = await screen.findByRole('button', { name: /Chosen session/ });
    fireEvent.click(screen.getByRole('button', { name: /^new chat$/i }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(chosen);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/chat/$sessionId', params: { sessionId: 'chosen' } }));
    finish('new-session');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not close a later selection when archiving the previous session finishes', async () => {
    route.pathname = '/chat/old';
    mockInvoke('reflect_current_workspace', async () => '/current');
    mockInvoke('reflect_list_sessions', async () => [
      { session_id: 'old', title: 'Old session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 },
      { session_id: 'next', title: 'Next session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('reflect_list_workspaces', async () => []);
    mockInvoke('reflect_set_workspace', async () => {});
    let finish!: () => void;
    mockInvoke('reflect_archive_session', () => new Promise<void>((resolve) => { finish = resolve; }));
    render(wrap(<AppShell />));
    const next = await screen.findByRole('button', { name: /Next session/ });
    fireEvent.click(screen.getByTestId('session-kebab-old'));
    fireEvent.click(screen.getByTestId('session-archive-old'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(next);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/chat/$sessionId', params: { sessionId: 'next' } }));
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('clearing all sessions unpins and closes the active session', async () => {
    route.pathname = '/chat/clear-active';
    if (!isPinned('clear-active')) togglePin('clear-active');
    mockInvoke('reflect_current_workspace', async () => '/current');
    mockInvoke('reflect_list_sessions', async () => [{ session_id: 'clear-active', title: 'Active session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 }]);
    mockInvoke('reflect_list_workspaces', async () => []);
    const remove = vi.fn(async () => undefined);
    mockInvoke('reflect_delete_session', remove);
    render(wrap(<AppShell />));
    await screen.findByRole('button', { name: /Active session/ });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.change(await screen.findByTestId('command-palette-input'), { target: { value: 'Clear all sessions' } });
    fireEvent.click(await screen.findByTestId('command-palette-item-sess.clear'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('reflect_delete_session', { id: 'clear-active' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/chat' }));
    expect(isPinned('clear-active')).toBe(false);
  });

  // 回归保护：TitleBar 必须挂 data-tauri-drag-region（否则窗口无法拖动），
  // 必须是 .shell 的第一个子元素（贯通全宽，红绿灯嵌在里面）。
  it('TitleBar is top-level (spans full width) and has drag region', () => {
    const { container } = render(wrap(<AppShell />));
    const titlebar = container.querySelector('[data-testid="titlebar"]');
    expect(titlebar).not.toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);

    // .shell 的第一个子元素应当是 titlebar（不是 ActivityBar）。
    const shell = container.firstChild as HTMLElement;
    expect(shell.firstChild).toBe(titlebar);
  });
});
