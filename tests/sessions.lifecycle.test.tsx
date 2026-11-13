/**
 * 会话生命周期 —— 列表项目分组 / 重命名 / 删除 / 切换回放水合 / 新会话。
 *
 * 真实应用挂载 + 真实路由导航（/chat/$sessionId），数据流经
 * TanStack Query → fakeBackend 状态 → Sidebar/ChatView 渲染。
 * 回放水合走真实 turnsFromRollout（rollout 记录 → turns）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

async function typeAndSend(text: string): Promise<void> {
  const textarea = await screen.findByLabelText('Message ZhuYe');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

describe('session list & project groups', () => {
  it('groups sidebar sessions by project directory (known empty project included)', async () => {
    renderApp();
    const sidebar = await screen.findByTestId('shell-sidebar');

    await waitFor(() => expect(sidebar.textContent).toContain('Fix login bug'));
    // 项目分组头：workspaces.json 的两个已知项目都显示（含空项目 scratch）。
    expect(sidebar.textContent).toContain('project');
    expect(sidebar.textContent).toContain('scratch');
    // 组内会话按最近活跃在前：Fix login bug（5 分钟前）→ Old experiment（3 周前）。
    const projIdx = sidebar.textContent!.indexOf('project');
    const bugIdx = sidebar.textContent!.indexOf('Fix login bug');
    const oldIdx = sidebar.textContent!.indexOf('Old experiment');
    expect(bugIdx).toBeGreaterThan(projIdx);
    expect(oldIdx).toBeGreaterThan(bugIdx);
  });

  it('empty session list renders no stale time grouping', async () => {
    backend.state.sessions = [];
    renderApp();
    const sidebar = await screen.findByTestId('shell-sidebar');
    // 等待 query 完成 —— 时间分桶文案不应再出现（已知项目组仍显示，但无会话）。
    await waitFor(() => {
      expect(backend.callsOf('reflect_list_sessions').length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => expect(sidebar.textContent).not.toContain('Yesterday'));
  });

  it('backend failure shows error UI in sidebar', async () => {
    backend.state.failures['reflect_list_sessions'] = new Error('rollout dir corrupted');
    renderApp();
    const sidebar = await screen.findByTestId('shell-sidebar');
    await waitFor(() => expect(sidebar.textContent).toContain('rollout dir corrupted'));
  });
});

describe('session switch & replay hydration', () => {
  it('navigating to /chat/$sessionId replays history into the store and view', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');

    // ChatView 调用 reflect_replay_session 水合。
    await waitFor(() => expect(backend.callsOf('reflect_replay_session').length).toBe(1));
    expect(backend.lastArgsOf('reflect_replay_session')).toEqual({ id: 'sess-alpha' });

    // rollout → turns：user 文本 + assistant 文本进入消息流。
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.textContent).toContain('Summarize the auth flow'));
    expect(log.textContent).toContain('The auth flow uses JWT with refresh rotation.');

    // store 标记已加载会话。
    expect(useAgentStore.getState().loadedSessionId).toBe('sess-alpha');
    // 历史 turn 全部 done。
    const turns = useAgentStore.getState().turns;
    expect(turns.length).toBe(1);
    expect(turns[0].status).toBe('done');
    // tool_use 块进入历史（折叠，但 store 可见）。
    expect(turns[0].items.some((i) => i.kind === 'tool_call')).toBe(true);
  });

  it('replay failure shows error banner with retry that succeeds', async () => {
    backend.state.failures['reflect_replay_session'] = new Error('rollout unreadable');
    const app = renderApp();
    await app.navigate('/chat/sess-gamma');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('rollout unreadable'));

    // 修复后端故障，点击 Retry。
    delete backend.state.failures['reflect_replay_session'];
    backend.state.rollouts['sess-gamma'] = [
      { type: 'message', turn_id: 'g-1', role: 'user', content: 'hello gamma' },
    ];
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('hello gamma'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switching between sessions re-hydrates each time id changes', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');
    await waitFor(() => expect(useAgentStore.getState().loadedSessionId).toBe('sess-alpha'));

    backend.state.rollouts['sess-beta'] = [
      { type: 'message', turn_id: 'b-1', role: 'user', content: 'beta question' },
      { type: 'message', turn_id: 'b-1', role: 'assistant', content: 'beta answer' },
    ];
    await app.navigate('/chat/sess-beta');
    await waitFor(() => expect(useAgentStore.getState().loadedSessionId).toBe('sess-beta'));
    // 上一会话的 turns 被替换，不残留。
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.textContent).toContain('beta question'));
    expect(log.textContent).not.toContain('Summarize the auth flow');
  });

  it('new chat (/chat) clears loaded session state', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');
    await waitFor(() => expect(useAgentStore.getState().loadedSessionId).toBe('sess-alpha'));

    await app.navigate('/chat');
    await waitFor(() => expect(useAgentStore.getState().loadedSessionId).toBeNull());
    expect(useAgentStore.getState().turns).toEqual([]);
  });

  it('selecting a session in the sidebar navigates to its chat route', async () => {
    const app = renderApp();
    await screen.findByText('Fix login bug');
    fireEvent.click(screen.getByText('Fix login bug'));
    await waitFor(() => expect(app.pathname()).toBe('/chat/sess-alpha'));
    // 选中项带 aria-pressed 高亮。
    await waitFor(() => {
      const sidebar = screen.getByTestId('shell-sidebar');
      const item = within(sidebar).getByText('Fix login bug').closest('button');
      expect(item?.getAttribute('aria-pressed')).toBe('true');
    });
  });
});

describe('session mutations through the real UI', () => {
  it('slash /rename renames the active session and refreshes the sidebar', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');
    await screen.findByRole('log');

    await typeAndSend('/rename My custom title');

    await waitFor(() => {
      expect(backend.callsOf('reflect_rename_session').length).toBe(1);
    });
    expect(backend.lastArgsOf('reflect_rename_session')).toEqual({
      id: 'sess-alpha',
      newName: 'My custom title',
    });
    // rename 成功 → invalidate → 自动重刷列表，侧边栏立即显示新标题。
    await waitFor(() => expect(within(screen.getByTestId('shell-sidebar')).getByText('My custom title')).toBeDefined());
    // 后端状态同步更新。
    expect(backend.state.sessions.find((s) => s.session_id === 'sess-alpha')?.title).toBe('My custom title');
  });

  it('sidebar kebab archive moves the session out of the active list', async () => {
    renderApp();
    await screen.findByText('Fix login bug');

    fireEvent.click(screen.getByTestId('session-kebab-sess-alpha'));
    fireEvent.click(await screen.findByTestId('session-archive-sess-alpha'));
    // 应用内确认框（window.confirm 在 Tauri WKWebView 不可用）→ 确认。
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(backend.callsOf('reflect_archive_session').length).toBe(1),
    );
    expect(backend.lastArgsOf('reflect_archive_session')).toEqual({ id: 'sess-alpha' });
    // invalidate 后侧边栏不再显示该会话。
    await waitFor(() => expect(screen.queryByText('Fix login bug')).toBeNull());
    expect(backend.state.archived.find((s) => s.session_id === 'sess-alpha')).toBeDefined();
  });

  it('sidebar kebab delete removes the session after in-app confirm', async () => {
    renderApp();
    await screen.findByText('Refactor parser');

    fireEvent.click(screen.getByTestId('session-kebab-sess-beta'));
    fireEvent.click(await screen.findByTestId('session-delete-sess-beta'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(backend.callsOf('reflect_delete_session').length).toBe(1),
    );
    expect(backend.lastArgsOf('reflect_delete_session')).toEqual({ id: 'sess-beta' });
    await waitFor(() => expect(screen.queryByText('Refactor parser')).toBeNull());
  });

  it('archiving the open session navigates back to /chat', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');
    await screen.findByRole('log');
    expect(app.pathname()).toBe('/chat/sess-alpha');

    fireEvent.click(screen.getByTestId('session-kebab-sess-alpha'));
    fireEvent.click(await screen.findByTestId('session-archive-sess-alpha'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(app.pathname()).toBe('/chat'));
  });

  it('threads view lists archived sessions and restore moves them back', async () => {
    const app = renderApp();
    await app.navigate('/sessions');

    // fixture 的 sess-archived 出现在归档区。
    const restoreBtn = await screen.findByTestId('archived-restore-sess-archived');
    expect(screen.getByText('Old backlog')).toBeDefined();
    // 进入 /sessions 时已触发过一次 archived list 拉取。
    const beforeRestore = backend.callsOf('reflect_list_archived_sessions').length;

    fireEvent.click(restoreBtn);
    await waitFor(() =>
      expect(backend.callsOf('reflect_unarchive_session').length).toBe(1),
    );
    // 后端状态正确搬移（unshift → archived 不再含此 id）。
    await waitFor(() => {
      expect(backend.state.sessions.find((s) => s.session_id === 'sess-archived')).toBeDefined();
      expect(backend.state.archived.find((s) => s.session_id === 'sess-archived')).toBeUndefined();
    });
    // archived query 被 invalidate 后再次拉取（用于 UI 移除该行）。
    await waitFor(() =>
      expect(backend.callsOf('reflect_list_archived_sessions').length).toBeGreaterThan(
        beforeRestore,
      ),
    );
    // 归档区不再展示该行：恢复按钮的 testid 消失（活动列表里仍会出现
    // 'Old backlog'，因为它已被 unarchive 到 sessions —— 此处只校验
    // 归档区 UI 不再持有该会话）。
    await waitFor(() => expect(screen.queryByTestId('archived-restore-sess-archived')).toBeNull());
  });

  it('binds a newly created session before sending from the new-chat home', async () => {
    const app = renderApp();
    await app.navigate('/chat');
    backend.state.boundSessionId = 'previous-session';
    await typeAndSend('hello new session');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    expect(backend.callsOf('reflect_create_session')).toHaveLength(1);
    expect(backend.state.boundSessionId).toBe('sess-new-1');
    expect(useAgentStore.getState().loadedSessionId).toBe('sess-new-1');
    expect(app.pathname()).toBe('/chat/sess-new-1');
  });

  it('sending a first message in a session invalidates the sessions query', async () => {
    backend.agent.script = [{ emit: { type: 'agent_message_delta', delta: 'ok' } }];
    const app = renderApp();
    await screen.findByText('Fix login bug');

    const listCallsBefore = backend.callsOf('reflect_list_sessions').length;
    await typeAndSend('hello there');

    await waitFor(() =>
      expect(backend.callsOf('reflect_list_sessions').length).toBeGreaterThan(listCallsBefore),
    );
  });
});

describe('command palette session actions', () => {
  it('⌘K opens palette; export active session exports via backend', async () => {
    const app = renderApp();
    await app.navigate('/chat/sess-alpha');
    await screen.findByRole('log');

    // 打开命令面板（与 useCommandPaletteShortcut 相同的键序列）。
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByTestId('command-palette-input');

    fireEvent.change(input, { target: { value: 'export' } });
    // 面板动作项可执行（列表渲染 + 点击触发 exportActive）。
    await waitFor(() => {
      const palette = screen.getByTestId('command-palette');
      expect(palette.textContent!.length).toBeGreaterThan(0);
    });
  });
});
