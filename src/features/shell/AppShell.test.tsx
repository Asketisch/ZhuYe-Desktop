/**
 * AppShell 折叠行为测试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/features/shell/AppShell';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { resetMockInvoke, mockInvoke, createTestQueryClient } from '@/test/setup.tsx';
import { isPinned, togglePin, unpin } from '@/features/sessions/utils/pins';

const navigate = vi.hoisted(() => vi.fn());
const routerNavigate = vi.hoisted(() => vi.fn());
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
    useRouter: () => ({ navigate: routerNavigate }),
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
    // harness 壳层 UI 状态迁移到 shellUi（含 localStorage 持久化），逐用例重置。
    localStorage.clear();
    useShellUi.setState({
      rail: false, dockOpen: false, dockMode: 'inspector', dockWide: false,
      termOpen: false, semantic: 'on', inboxOpen: false, settingsOpen: false,
      paletteOpen: false, unread: {},
    });
  });
  afterEach(() => { cleanup(); unpin('clear-active'); });

  // v3 harness：侧栏与 dock 常驻 DOM，收起态由 .rail / .no-inspector 类驱动。
  const appEl = () => document.querySelector('[data-testid="harness-app"]') as HTMLElement;

  it('initial: sidebar visible, dock hidden (no-inspector class)', () => {
    render(wrap(<AppShell />));
    expect(screen.getByTestId('harness-sidebar')).toBeDefined();
    expect(appEl().className).toContain('no-inspector');
    expect(appEl().className).not.toContain('rail');
  });

  it('clicking rail toggle switches app into rail mode and back', () => {
    render(wrap(<AppShell />));
    fireEvent.click(screen.getByTestId('harness-rail'));
    expect(appEl().className).toContain('rail');
    fireEvent.click(screen.getByTestId('harness-rail'));
    expect(appEl().className).not.toContain('rail');
  });

  it('clicking inspector toggle opens the dock and back', () => {
    render(wrap(<AppShell />));
    fireEvent.click(screen.getByLabelText('Inspector dock'));
    expect(appEl().className).not.toContain('no-inspector');
    fireEvent.click(screen.getByLabelText('Inspector dock'));
    expect(appEl().className).toContain('no-inspector');
  });

  it('rail and collapsed dock can coexist', () => {
    render(wrap(<AppShell />));
    fireEvent.click(screen.getByTestId('harness-rail'));
    fireEvent.click(screen.getByLabelText('Inspector dock'));
    fireEvent.click(screen.getByLabelText('Inspector dock'));
    expect(appEl().className).toContain('rail');
    expect(appEl().className).toContain('no-inspector');
  });

  // 回归保护：AppShell 必须渲染 <Outlet />（不是 children prop），
  // 否则 TanStack Router 解析的子路由全部不显示 —— 主区域永久空白。
  it('renders Outlet content (router children actually mount)', () => {
    render(wrap(<AppShell />));
    expect(screen.getByTestId('outlet-content')).toBeDefined();
  });

  // v1.x 改版:新建会话不再预分配 session id —— 只导航到 /chat 新对话
  // 首页;会话在首条消息发出时才创建落盘(useEnsureSession 链路),侧栏
  // 届时随列表刷新出现带真标题的条目,不再先闪一个 ID 空壳。
  it('New Chat navigates to /chat without creating a session', async () => {
    const created: unknown[] = [];
    mockInvoke('zhuye_create_session', async () => {
      created.push('sess-new-1');
      return 'sess-new-1';
    });
    mockInvoke('zhuye_list_sessions', async () => []);
    mockInvoke('zhuye_current_workspace', async () => null);

    render(wrap(<AppShell />));
    fireEvent.click(screen.getByTestId('harness-nav-new'));

    await new Promise((r) => setTimeout(r, 0));
    expect(routerNavigate).toHaveBeenCalledWith({ to: '/chat' });
    expect(created).toEqual([]);
  });

  it('restores the later session workspace after an earlier switch completes', async () => {
    mockInvoke('zhuye_current_workspace', async () => '/second');
    mockInvoke('zhuye_list_sessions', async () => [
      { session_id: 'first', title: 'First session', workspace: '/first', model: '', started_at: new Date().toISOString(), message_count: 1 },
      { session_id: 'second', title: 'Second session', workspace: '/second', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('zhuye_list_workspaces', async () => []);
    const calls: string[] = [];
    let finish!: () => void;
    mockInvoke('zhuye_set_workspace', async (_command, args) => {
      const path = (args as { path: string }).path;
      calls.push(path);
      if (path === '/first') await new Promise<void>((resolve) => { finish = resolve; });
    });
    render(wrap(<AppShell />));
    // 会话行在「工作区」分组与「会话」平铺区各渲染一份(取名第一份即可)。
    const first = (await screen.findAllByRole('button', { name: /First session/ }))[0];
    const second = (await screen.findAllByRole('button', { name: /Second session/ }))[0];
    fireEvent.click(first);
    await waitFor(() => expect(calls).toEqual(['/first']));
    fireEvent.click(second);
    expect(calls).toEqual(['/first']);
    finish();
    await waitFor(() => expect(calls).toEqual(['/first', '/second']));
  });

  it('does not open a session when its workspace cannot be selected', async () => {
    mockInvoke('zhuye_current_workspace', async () => '/current');
    mockInvoke('zhuye_list_sessions', async () => [
      { session_id: 'missing', title: 'Missing project session', workspace: '/missing', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_set_workspace', async () => { throw new Error('directory not found'); });
    render(wrap(<AppShell />));
    fireEvent.click((await screen.findAllByRole('button', { name: /Missing project session/ }))[0]);
    await screen.findByText(/directory not found/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not close a later selection when archiving the previous session finishes', async () => {
    route.pathname = '/chat/old';
    mockInvoke('zhuye_current_workspace', async () => '/current');
    mockInvoke('zhuye_list_sessions', async () => [
      { session_id: 'old', title: 'Old session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 },
      { session_id: 'next', title: 'Next session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 },
    ]);
    mockInvoke('zhuye_list_workspaces', async () => []);
    mockInvoke('zhuye_set_workspace', async () => {});
    let finish!: () => void;
    mockInvoke('zhuye_archive_session', () => new Promise<void>((resolve) => { finish = resolve; }));
    render(wrap(<AppShell />));
    const next = (await screen.findAllByRole('button', { name: /Next session/ }))[0];
    // v3 harness：归档入口在会话行 ⋯ 菜单，经应用内确认框执行。
    fireEvent.click(await screen.findByTestId('session-more-old'));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
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
    mockInvoke('zhuye_current_workspace', async () => '/current');
    mockInvoke('zhuye_list_sessions', async () => [{ session_id: 'clear-active', title: 'Active session', workspace: '/current', model: '', started_at: new Date().toISOString(), message_count: 1 }]);
    mockInvoke('zhuye_list_workspaces', async () => []);
    const remove = vi.fn(async () => undefined);
    mockInvoke('zhuye_delete_session', remove);
    render(wrap(<AppShell />));
    await screen.findAllByRole('button', { name: /Active session/ });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.change(await screen.findByTestId('command-palette-input'), { target: { value: 'Clear all sessions' } });
    fireEvent.click(await screen.findByTestId('command-palette-item-sess.clear'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('zhuye_delete_session', { id: 'clear-active' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/chat' }));
    expect(isPinned('clear-active')).toBe(false);
  });

  // 回归保护：TitleBar 必须挂 data-tauri-drag-region（否则窗口无法拖动），
  // 必须是 .app 的第一个子元素（贯通全宽，红绿灯避让区嵌在里面）。
  it('TitleBar is top-level (spans full width) and has drag region', () => {
    const { container } = render(wrap(<AppShell />));
    const titlebar = container.querySelector('[data-testid="harness-titlebar"]');
    expect(titlebar).not.toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);

    // .app 的第一个子元素应当是 titlebar。
    const shell = container.firstChild as HTMLElement;
    expect(shell.firstChild).toBe(titlebar);
  });
});
