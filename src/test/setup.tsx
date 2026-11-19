/**
 * Vitest 测试环境 —— 模拟 Tauri 2 API。
 *
 * useSessions hook 依赖 `invoke('reflect_list_sessions')` 和
 * `invoke('reflect_rename_session', ...)`;
 * useAgent hook 依赖 `invoke('reflect_submit', ...)` + `listen('reflect_event', ...)`。
 *
 * 使用 fake timers + 手动 resolve 来模拟后端响应。
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render as rtlRender, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { resetUiPrefsForTests } from '@/utils/uiPrefs';
import { resetPinsForTests } from '@/features/sessions/utils/pins';

// ====== DOM polyfills(jsdom 缺失,CodeMirror 6 依赖) ======

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// ====== Tauri invoke mock ======

type InvokeHandler = (...args: any[]) => Promise<unknown>;

const invokeHandlers = new Map<string, InvokeHandler>();

export function mockInvoke(cmd: string, handler: InvokeHandler) {
  invokeHandlers.set(cmd, handler);
}

export function resetMockInvoke() {
  invokeHandlers.clear();
}

// 默认 handler
beforeEach(() => {
  resetMockInvoke();

  // reflect_list_sessions — 返回 3 个 stub session
  mockInvoke('reflect_list_sessions', async () => [
    {
      session_id: 'sess-1',
      thread_id: 'thread-1',
      model: 'stub/test',
      provider: 'local',
      started_at: new Date(Date.now() - 3600000).toISOString(),
      message_count: 2,
      tool_count: 0,
      token_total: 0,
      cwd: '/tmp',
      display_name: 'First session',
    },
    {
      session_id: 'sess-2',
      thread_id: 'thread-2',
      model: 'stub/test',
      provider: 'local',
      started_at: new Date(Date.now() - 86400000).toISOString(),
      message_count: 5,
      tool_count: 1,
      token_total: 120,
      cwd: '/tmp',
      display_name: 'Second session',
    },
    {
      session_id: 'sess-3',
      thread_id: 'thread-3',
      model: 'stub/test',
      provider: 'local',
      started_at: new Date(Date.now() - 172800000).toISOString(),
      message_count: 1,
      tool_count: 0,
      token_total: 0,
      cwd: '/tmp',
      display_name: null,
    },
  ]);

  // reflect_rename_session
  mockInvoke('reflect_rename_session', async (_id: string, _new_name: string) => {});

  // reflect_current_workspace —— 默认未打开工作区(null);AppShell 的 useCurrentWorkspace 依赖
  mockInvoke('reflect_current_workspace', async () => null);

  // reflect_pick_files —— 附件多选框默认「用户取消」(null),组件测试按需覆写
  mockInvoke('reflect_pick_files', async () => null);

  // reflect_ingest_upload —— 字节落盘默认成功,返回工作区内路径(A1 附件管线)
  mockInvoke('reflect_ingest_upload', async (_command: string, args: { filename: string }) => ({
    path: `/Users/dev/project/.zhuye/uploads/stub_${args.filename}`,
    size: 5,
  }));

  // reflect_create_session —— 纯 ID 分配(首条 submission 时后端物化)
  mockInvoke('reflect_create_session', async () => 'sess-stub-new');

  // reflect_bind_session —— 把后端 AgentThread 绑到指定 session id
  // (后端幂等;未知 id 走空历史分支,不报错 → mock 为 no-op)
  mockInvoke('reflect_bind_session', async () => 'auto');

  // reflect_list_archived_sessions —— 默认无归档会话
  mockInvoke('reflect_list_archived_sessions', async () => []);

  // reflect_set_permission_mode
  mockInvoke('reflect_set_permission_mode', async () => {});

  // ComposerControls / ModelsView —— 模型与 effort 读写默认 stub
  // （具体测试可自行 override 返回值）。
  mockInvoke('reflect_get_config', async () => '');
  mockInvoke('reflect_config_info', async () => ({ path: null, exists: false, analyticsEnabled: false, analyticsStatus: '', workspace: '', activeAgent: '', issues: [] }));
  mockInvoke('reflect_agent_status', async () => ({
    ready: false,
    has_model: false,
    model: 'stub/test',
    workspace: '/tmp',
    degraded_reason: null,
  }));
  mockInvoke('reflect_set_model', async (_provider: string, _model: string) => 'stub/test');
  mockInvoke('reflect_get_effort', async () => 'low');
  mockInvoke('reflect_set_effort', async () => 'ok');

  // v1.x P1-P3 新命令默认 stub（具体测试可自行 override）。
  mockInvoke('reflect_git_status', async () => ({
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
    raw: '',
    is_repo: false,
  }));
  mockInvoke('reflect_git_diff', async () => '');
  mockInvoke('reflect_search_sessions', async () => []);
  mockInvoke('reflect_list_skills', async () => []);
  mockInvoke('reflect_search_skill_market', async () => []);
  mockInvoke('reflect_install_skill_from_market', async () => 'sub-fake');
  mockInvoke('reflect_refresh_skill_market_index', async () => 0);
  mockInvoke('reflect_install_skill', async () => 'sub-fake');
  mockInvoke('reflect_list_hooks', async () => []);
  mockInvoke('reflect_list_plugin_commands', async () => []);
  mockInvoke('reflect_toggle_hook', async () => {});
  mockInvoke('reflect_gh_pr_list', async () => []);
  mockInvoke('reflect_git_stage', async () => {});
  mockInvoke('reflect_git_unstage', async () => {});
  mockInvoke('reflect_git_commit', async () => 'abc1234');
  mockInvoke('reflect_list_dir', async () => ({ entries: [], cwd: '/tmp' }));
  mockInvoke('reflect_run_shell', async () => ({ id: 'shell-test-1', command: 'x', cwd: '/tmp' }));

  // reflect_submit
  mockInvoke('reflect_submit', async (submission: { id: string }) => submission.id);

  // Phase 2 条目 2 — remote daemon 占位实现(对未通过 vi.mock 覆盖的测试
  // 默认 no-op;具体测试可自行 override)。
  mockInvoke('reflect_tailscale_daemon_command_preview', async () => '');
  mockInvoke('reflect_tailscale_daemon_start', async () => '');
  mockInvoke('reflect_tailscale_daemon_stop', async () => '');
  mockInvoke('reflect_tailscale_daemon_status', async () => '');
  mockInvoke('reflect_get_remote_status', async () => ({
    state: 'disconnected',
    message: null,
    endpoint: null,
    sinceMs: null,
  }));

  // ping
  mockInvoke('ping', async () => ({ msg: 'pong', version: '0.1.0' }));
});

// ====== 模拟 @tauri-apps/api/core ======

vi.mock('@tauri-apps/api/core', () => {
  const actual = vi.importActual('@tauri-apps/api/core');
  return {
    ...actual,
    invoke: async function (cmd: string, args?: unknown) {
      const handler = invokeHandlers.get(cmd);
      if (handler) return handler(cmd, args);
      throw new Error(`[mock] invoke('${cmd}') not mocked`);
    },
  };
});

// ====== 模拟 @tauri-apps/api/event ======

type EventHandler = (payload: any) => void;
const eventHandlers = new Map<string, Set<EventHandler>>();

export function emitMockEvent(event: string, payload: unknown) {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    for (const fn of handlers) fn({ payload });
  }
}

export function resetMockEvents() {
  eventHandlers.clear();
}

vi.mock('@tauri-apps/api/event', () => {
  const actual = vi.importActual('@tauri-apps/api/event');
  return {
    ...actual,
    listen: async function (event: string, handler: (e: { payload: unknown }) => void) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
      return () => {
        eventHandlers.get(event)?.delete(handler);
      };
    },
  };
});

afterEach(() => {
  cleanup();
  resetMockEvents();
  vi.clearAllMocks();
  // uiPrefs / pins 模块级缓存 + localStorage 跨测试复位，保证偏好类断言确定性。
  resetUiPrefsForTests();
  resetPinsForTests();
  window.localStorage.clear();
});

// jsdom 没有实现 scrollIntoView,这里为需要自动滚动的组件做 stub。
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* jsdom 下无需操作 */
  };
}

// ====== 测试工具 ======

/**
 * 创建用于测试的 QueryClient。
 * 每个测试独立实例,避免缓存泄漏。
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

/**
 * 包裹组件进 QueryClientProvider,用于需要 TanStack Query 的测试。
 */
export function renderWithQueryClient(
  ui: ReactNode,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  const queryClient = createTestQueryClient();
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });
}
