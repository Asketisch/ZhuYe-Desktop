/**
 * Vitest 测试环境 —— 模拟 Tauri 2 API。
 *
 * useSessions hook 依赖 `invoke('zhuye_list_sessions')` 和
 * `invoke('zhuye_rename_session', ...)`;
 * useAgent hook 依赖 `invoke('zhuye_submit', ...)` + `listen('zhuye_event', ...)`。
 *
 * 使用 fake timers + 手动 resolve 来模拟后端响应。
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render as rtlRender, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { resetUiPrefsForTests } from '@/utils/uiPrefs';
import { resetPinsForTests } from '@/logic/conversation/sessions/pins';

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

  // zhuye_list_sessions — 返回 3 个 stub session
  mockInvoke('zhuye_list_sessions', async () => [
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

  // zhuye_rename_session
  mockInvoke('zhuye_rename_session', async (_id: string, _new_name: string) => {});

  // zhuye_current_workspace —— 默认未打开工作区(null);AppShell 的 useCurrentWorkspace 依赖
  mockInvoke('zhuye_current_workspace', async () => null);

  // zhuye_pick_files —— 附件多选框默认「用户取消」(null),组件测试按需覆写
  mockInvoke('zhuye_pick_files', async () => null);

  // zhuye_ingest_upload —— 字节落盘默认成功,返回工作区内路径(A1 附件管线)
  mockInvoke('zhuye_ingest_upload', async (_command: string, args: { filename: string }) => ({
    path: `/Users/dev/project/.zhuye/uploads/stub_${args.filename}`,
    size: 5,
  }));

  // zhuye_create_session —— 纯 ID 分配(首条 submission 时后端物化)
  mockInvoke('zhuye_create_session', async () => 'sess-stub-new');

  // zhuye_bind_session —— 把后端 AgentThread 绑到指定 session id
  // (后端幂等;未知 id 走空历史分支,不报错 → mock 为 no-op)
  // 返回值是结构体(权限模式 + 挂起交互快照 + 提示词 override)。
  mockInvoke('zhuye_bind_session', async () => ({
    permission_mode: 'auto',
    pending_gates: [],
    prompt_selection: null,
  }));

  // zhuye_list_archived_sessions —— 默认无归档会话
  mockInvoke('zhuye_list_archived_sessions', async () => []);

  // zhuye_set_permission_mode
  mockInvoke('zhuye_set_permission_mode', async () => {});

  // Models 页 / 输入卡控制件 —— 模型与 effort 读写默认 stub
  // （具体测试可自行 override 返回值）。
  mockInvoke('zhuye_get_config', async () => '');
  mockInvoke('zhuye_config_info', async () => ({ path: null, exists: false, analyticsEnabled: false, analyticsStatus: '', workspace: '', activeAgent: '', issues: [] }));
  mockInvoke('zhuye_agent_status', async () => ({
    ready: false,
    has_model: false,
    model: 'stub/test',
    workspace: '/tmp',
    degraded_reason: null,
  }));
  mockInvoke('zhuye_set_model', async (_provider: string, _model: string) => 'stub/test');
  mockInvoke('zhuye_get_effort', async () => 'low');
  mockInvoke('zhuye_set_effort', async () => 'ok');
  // 思考强度能力（能力未知 → 兜底展示全部档位，具体测试自行 override）。
  mockInvoke('zhuye_effort_capability', async () => ({
    known: false, supported: ['low', 'medium', 'high', 'max', 'ultra'],
    requested: 'low', effective: 'low', adjusted: false, model: 'stub/test',
  }));
  // 空会话态「+」菜单的提示词清单拉取(prompt_list 应答经事件通道
  // 回流,stub 只需让 invoke 静默成功 —— 具体测试自行 override)。
  mockInvoke('zhuye_prompt_command', async () => 'sub-stub');
  mockInvoke('zhuye_get_effective_prompt', async () => ({
    model: 'stub/test', layers: [], sections: [],
  }));

  // v1.x P1-P3 新命令默认 stub（具体测试可自行 override）。
  mockInvoke('zhuye_git_status', async () => ({
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
    raw: '',
    is_repo: false,
  }));
  mockInvoke('zhuye_git_diff', async () => '');
  // worktree 管理(实现下沉 app-core,GUI 测试只需空列表 + 成功 no-op)。
  mockInvoke('zhuye_list_worktrees', async () => []);
  mockInvoke('zhuye_create_worktree', async (name: string) => ({
    path: `/tmp/fake-proj-worktrees/${name}`,
    branch: name,
    head: 'fake0000',
    dirty: false,
    isolated: true,
    stranded: false,
  }));
  mockInvoke('zhuye_remove_worktree', async () => undefined);
  mockInvoke('zhuye_prune_worktrees', async () => undefined);
  // 输入卡顶栏（工作区 / 分支 / worktree 开关）默认 stub：空工作区、
  // 非 repo、无远端会话；切换/选择动作 no-op，具体测试自行 override。
  mockInvoke('zhuye_remote_sessions', async () => []);
  mockInvoke('zhuye_list_workspaces', async () => []);
  mockInvoke('zhuye_set_workspace', async () => undefined);
  mockInvoke('zhuye_pick_workspace_folder', async () => null);
  mockInvoke('zhuye_git_branches', async () => []);
  mockInvoke('zhuye_git_checkout', async () => undefined);
  mockInvoke('zhuye_search_sessions', async () => []);
  mockInvoke('zhuye_list_skills', async () => []);
  mockInvoke('zhuye_search_skill_market', async () => []);
  mockInvoke('zhuye_install_skill_from_market', async () => 'sub-fake');
  mockInvoke('zhuye_refresh_skill_market_index', async () => 0);
  mockInvoke('zhuye_install_skill', async () => 'sub-fake');
  mockInvoke('zhuye_list_hooks', async () => []);
  mockInvoke('zhuye_list_plugin_commands', async () => []);
  mockInvoke('zhuye_toggle_hook', async () => {});
  mockInvoke('zhuye_gh_pr_list', async () => []);
  mockInvoke('zhuye_git_stage', async () => {});
  mockInvoke('zhuye_git_unstage', async () => {});
  mockInvoke('zhuye_git_commit', async () => 'abc1234');
  mockInvoke('zhuye_list_dir', async () => ({ entries: [], cwd: '/tmp' }));
  mockInvoke('zhuye_run_shell', async () => ({ id: 'shell-test-1', command: 'x', cwd: '/tmp' }));

  // zhuye_submit
  mockInvoke('zhuye_submit', async (submission: { id: string }) => submission.id);

  // Phase 2 条目 2 — remote daemon 占位实现(对未通过 vi.mock 覆盖的测试
  // 默认 no-op;具体测试可自行 override)。
  mockInvoke('zhuye_tailscale_daemon_command_preview', async () => '');
  mockInvoke('zhuye_tailscale_daemon_start', async () => '');
  mockInvoke('zhuye_tailscale_daemon_stop', async () => '');
  mockInvoke('zhuye_tailscale_daemon_status', async () => '');
  mockInvoke('zhuye_get_remote_status', async () => ({
    state: 'disconnected',
    message: null,
    endpoint: null,
    sinceMs: null,
  }));

  // ping
  mockInvoke('ping', async () => ({ msg: 'pong', version: '0.1.0' }));
  // 侧栏底部版本 / 更新提示：默认「已是最新」，单测可按需 override。
  mockInvoke('zhuye_check_update', async () => ({
    currentVersion: '0.1.0',
    latestVersion: '0.1.0',
    updateAvailable: false,
    releaseUrl: null,
    releaseNotes: null,
    probedAt: 0,
    error: null,
  }));
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
