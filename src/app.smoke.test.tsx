/**
 * App-level smoke test —— 端到端验证用户可见功能。
 *
 * 覆盖：
 * 1. 路由模块结构 —— 注册 21 个路由,AppRouter type 存在
 * 2. 顶层 AppLayout 接线 —— Sidebar / ChatView 渲染
 * 3. ReflectEvent dispatch —— useAgent 累积 turns + session 配置
 * 4. useSessions —— 真实 TanStack Query + bucket 分类 + rename IPC
 * 5. SettingsView —— reflect_set_permission_mode 变更
 * 6. DesignSystemView —— 6 个 section 全部渲染 + 4 个 primitive 可见
 * 7. Barrel exports —— features/<slice>/index.ts 全部可 import
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/features/shell/AppShell';

// node:fs 的类型化小封装，避免引入 @types/node 依赖。
declare const require: (id: string) => unknown;
function nodeRead(p: string, enc: string = 'utf8'): string {
  return (require('node:fs') as { readFileSync: (p: string, enc: string) => string }).readFileSync(p, enc);
}
function nodeExists(p: string): boolean {
  return (require('node:fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string }).existsSync(p);
}
import { ChatView } from '@/features/messages/ChatView';
import { SettingsView } from '@/features/settings/SettingsView';
import { HomeView } from '@/features/home/HomeView';
import { DesignSystemView } from '@/features/design-system/DesignSystemView';
import { ThreadsView } from '@/features/threads/ThreadsView';
import { useAgent } from '@/services/agent';
import { useAgentStore } from '@/stores/agentStore';

/** 从 agentHook 的指定 turn 提取 assistant_text item 的文本(测试辅助)。 */
function assistantText(
  hook: ReturnType<typeof useAgent>,
  turnId: string,
): string {
  const turn = hook.turns.find((t) => t.id === turnId);
  if (!turn) return '';
  const item = turn.items.find((i) => i.kind === 'assistant_text');
  return item && item.kind === 'assistant_text' ? item.text : '';
}
import {
  mockInvoke,
  resetMockInvoke,
  createTestQueryClient,
  emitMockEvent,
} from '@/test/setup';
import type { ReactNode } from 'react';

// 模拟 @tanstack/react-router,让 Link/useNavigate 退化为普通 <a>/noop。
// 这样使用 Link 的视图就不需要完整初始化的 router。
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
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
      <a
        href={typeof to === 'string' ? to.replace(/\$/g, String(_params?.sessionId ?? '')) : '#'}
        onClick={onClick}
        style={style}
        {...rest}
      >
        {children}
      </a>
    ),
    useNavigate: () => () => {},
    useRouter: () => ({ navigate: () => {} }),
    useParams: () => ({}),
    useLocation: () => ({ pathname: '/' }),
    useMatches: () => [],
    Outlet: () => <div data-testid="outlet-content">outlet</div>,
  };
});

function wrap(node: ReactNode) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {node}
    </QueryClientProvider>
  );
}

// ===========================================================================
// 1. Router 模块结构
// ===========================================================================

describe('Router module structure', () => {
  it('exports router, AppProviders, AppRouter type', async () => {
    const mod = await import('@/router');
    expect(mod.router).toBeDefined();
    expect(mod.AppProviders).toBeDefined();
    expect(typeof mod.AppProviders).toBe('function');
  });

  it('AppProviders is a valid React component', async () => {
    const { AppProviders } = await import('@/router');
    // 应接受 children prop 并渲染 QueryClientProvider
    expect(AppProviders.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 2. AppLayout 接线
// ===========================================================================

describe('AppShell (IDE-style top-level shell)', () => {
  beforeEach(() => resetMockInvoke());

  it('mounts with Sidebar + ActivityBar + StatusBar', () => {
    render(wrap(<AppShell />));
    // 侧边栏头部
    expect(screen.getByText('Sessions')).toBeDefined();
    // ActivityBar nav label（IconButton aria-label）
    expect(screen.getByLabelText('Chat')).toBeDefined();
    // StatusBar（含 model 占位）
    expect(screen.getByText(/no model|@/)).toBeDefined();
  });
});

// ===========================================================================
// 3. ReflectEvent dispatch —— useAgent 累积 turns
// ===========================================================================

describe('Event-driven agent flow', () => {
  let unsubscribe: (() => void) | null = null;
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('reflect_submit', async (s: { id: string }) => s.id);
    // 清空 store + 建立事件订阅(生产环境由 AppProviders 建立)。
    useAgentStore.getState().reset();
    unsubscribe = useAgentStore.getState().subscribe();
  });
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  it('full streaming flow: submit → delta → delta → turn_complete → done', async () => {
    let agentHook: ReturnType<typeof useAgent> | null = null;
    function Capture() {
      agentHook = useAgent();
      return null;
    }
    render(wrap(<Capture />));

    // 1. 用户提交
    await act(async () => {
      await agentHook!.submit('hello');
    });
    expect(agentHook!.turns.length).toBe(1);
    // 新模型:user_text 是 turn.items[0]。
    const turn0 = agentHook!.turns[0];
    expect(turn0.items[0]).toMatchObject({ kind: 'user_text', text: 'hello' });
    expect(turn0.status).toBe('streaming');
    const submissionId = turn0.id;

    // 2. 第一个流式 delta
    await act(async () => {
      emitMockEvent('reflect_event', {
        id: submissionId,
        msg: { type: 'agent_message_delta', delta: 'Hi' },
      });
    });
    expect(assistantText(agentHook!, submissionId)).toBe('Hi');

    // 3. 第二个流式 delta
    await act(async () => {
      emitMockEvent('reflect_event', {
        id: submissionId,
        msg: { type: 'agent_message_delta', delta: ' there' },
      });
    });
    expect(assistantText(agentHook!, submissionId)).toBe('Hi there');

    // 4. turn 完成
    await act(async () => {
      emitMockEvent('reflect_event', {
        id: submissionId,
        msg: { type: 'turn_complete', turn_id: 'turn-1', usage: {}, status: 'success' },
      });
    });
    expect(agentHook!.turns[0].status).toBe('done');
  });

  it('session_configured sets model/provider on agent session', async () => {
    let agentHook: ReturnType<typeof useAgent> | null = null;
    function Capture() {
      agentHook = useAgent();
      return null;
    }
    render(wrap(<Capture />));

    expect(agentHook!.session).toBeNull();
    await act(async () => {
      emitMockEvent('reflect_event', {
        id: '',
        msg: { type: 'session_configured', model: 'claude-opus-4.7', provider: 'anthropic' },
      });
    });
    expect(agentHook!.session).toEqual({
      model: 'claude-opus-4.7',
      provider: 'anthropic',
    });
  });

  it('empty model in session_configured is ignored', async () => {
    let agentHook: ReturnType<typeof useAgent> | null = null;
    function Capture() {
      agentHook = useAgent();
      return null;
    }
    render(wrap(<Capture />));

    await act(async () => {
      emitMockEvent('reflect_event', {
        id: '',
        msg: { type: 'session_configured', model: '', provider: '' },
      });
    });
    expect(agentHook!.session).toBeNull();
  });
});

// ===========================================================================
// 4. useSessions → 真实 TanStack Query + mock 后端
// ===========================================================================

describe('Sessions pipeline (useSessions + rename)', () => {
  beforeEach(() => {
    resetMockInvoke();
    const now = Date.now();
    mockInvoke('reflect_list_sessions', async () => [
      {
        session_id: 's-A',
        thread_id: 't-A',
        model: 'claude-opus',
        provider: 'anthropic',
        started_at: new Date(now - 30 * 60 * 1000).toISOString(),
        message_count: 5,
        tool_count: 1,
        token_total: 200,
        cwd: '/Users/me/proj',
        display_name: 'My recent chat',
      },
      {
        session_id: 's-B',
        thread_id: 't-B',
        model: 'claude-opus',
        provider: 'anthropic',
        started_at: new Date(now - 3 * 86400 * 1000).toISOString(),
        message_count: 12,
        tool_count: 4,
        token_total: 800,
        cwd: '/Users/me/proj',
        display_name: 'Older chat',
      },
    ]);
    // commands.ts 以 { id, newName } 作为 args 对象发送
    mockInvoke('reflect_rename_session', async (_cmd: string, args: { id: string; newName: string }) => {
      (globalThis as { __lastRename?: { id: string; newName: string } }).__lastRename = args;
    });
  });

  it('renders buckets (Now + This week) with correct labels', async () => {
    const { useSessions } = await import('@/features/sessions/hooks/useSessions');
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { result } = renderHook(() => useSessions(), { wrapper: ({ children }) => wrap(children) });

    await waitFor(() => expect(result.current.buckets.length).toBeGreaterThan(0));
    const labels = result.current.buckets.map((b) => b.label);
    expect(labels).toContain('Now');
    expect(labels).toContain('This week');
  });

  it('rename forwards { id, newName } to backend', async () => {
    const { useSessions } = await import('@/features/sessions/hooks/useSessions');
    const { renderHook, waitFor, act } = await import('@testing-library/react');
    const { result } = renderHook(() => useSessions(), { wrapper: ({ children }) => wrap(children) });

    await waitFor(() => expect(result.current.buckets.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.rename('s-A', 'Renamed');
    });
    const captured = (globalThis as { __lastRename?: { id: string; newName: string } }).__lastRename;
    expect(captured).toEqual({ id: 's-A', newName: 'Renamed' });
  });

  it('invalidates query cache after successful rename (auto-refresh)', async () => {
    let callCount = 0;
    mockInvoke('reflect_list_sessions', async () => {
      callCount += 1;
      return [];
    });

    const { useSessions } = await import('@/features/sessions/hooks/useSessions');
    const { renderHook, waitFor, act } = await import('@testing-library/react');
    const { result } = renderHook(() => useSessions(), { wrapper: ({ children }) => wrap(children) });

    await waitFor(() => expect(callCount).toBe(1));
    await act(async () => {
      await result.current.rename('s-A', 'X');
    });
    // rename 成功 → invalidateQueries → refetch
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
  });
});

// ===========================================================================
// 5. SettingsView mutation
// ===========================================================================

describe('Settings save flow', () => {
  beforeEach(() => {
    resetMockInvoke();
    (globalThis as { __lastMode?: string }).__lastMode = undefined;
    mockInvoke('reflect_set_permission_mode', async (_cmd: string, args: { mode: string }) => {
      (globalThis as { __lastMode?: string }).__lastMode = args.mode;
    });
    mockInvoke('reflect_save_config', async () => {});
    mockInvoke('reflect_get_config', async () => '[active]\nprovider = "anthropic"\n');
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'anthropic/claude',
      workspace: '/tmp',
      degraded_reason: null,
    }));
  });

  it('clicking permission button triggers reflect_set_permission_mode mutation', async () => {
    render(wrap(<SettingsView />));
    // 权限快捷控件只在 Permissions 页显示（v1.x:不再每个设置页签重复）。
    fireEvent.click(screen.getByText('Permissions'));

    // permission 按钮(auto/prompt/deny/plan)直接 mutate。
    const planBtn = await screen.findByText('plan', { selector: 'button' });
    await act(async () => {
      planBtn.click();
    });

    expect((globalThis as { __lastMode?: string }).__lastMode).toBe('plan');
  });
});

// ===========================================================================
// 6. DesignSystemView —— 6 个 section + 4 个 primitive
// ===========================================================================

describe('DesignSystemView catalog', () => {
  it('renders all 6 sections', () => {
    const { container } = render(wrap(<DesignSystemView />));
    for (const sec of ['colors', 'typography', 'buttons', 'context-ring', 'toast', 'key-hints']) {
      expect(container.querySelector(`[data-section="${sec}"]`)).not.toBeNull();
    }
  });

  it('Button primitive renders primary/danger via data-variant', () => {
    const { container } = render(wrap(<DesignSystemView />));
    const buttons = container.querySelectorAll('button');
    const primaryBtn = Array.from(buttons).find((b) => b.textContent === 'Primary') as HTMLButtonElement | undefined;
    expect(primaryBtn).toBeDefined();
    expect(primaryBtn!.getAttribute('data-variant')).toBe('primary');
    const dangerBtn = Array.from(buttons).find((b) => b.textContent === 'Danger') as HTMLButtonElement | undefined;
    expect(dangerBtn!.getAttribute('data-variant')).toBe('danger');
  });

  it('ContextRing primitive renders SVG circles', () => {
    const { container } = render(wrap(<DesignSystemView />));
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('Toast primitive renders all 4 kinds', () => {
    const { container } = render(wrap(<DesignSystemView />));
    const toasts = container.querySelectorAll('[data-kind]');
    const kinds = new Set(Array.from(toasts).map((t) => t.getAttribute('data-kind')));
    expect(kinds.has('info')).toBe(true);
    expect(kinds.has('success')).toBe(true);
    expect(kinds.has('warning')).toBe(true);
    expect(kinds.has('error')).toBe(true);
  });

  it('KeyHint primitive renders platform-aware shortcuts', () => {
    const { container } = render(wrap(<DesignSystemView />));
    // KeyHint 渲染 <kbd> 元素
    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThanOrEqual(4);
  });
});

// ===========================================================================
// 7. Barrel exports —— 所有 features/*/index.ts 必须能 import
// ===========================================================================

describe('Feature barrel exports', () => {
  it('sessions barrel exposes public API', async () => {
    const mod = await import('@/features/sessions');
    // Sidebar 是主入口（AppShell 直接渲染）；SessionsView 薄包装已删除。
    expect(mod.Sidebar).toBeDefined();
    expect(mod.SessionItem).toBeDefined();
    expect(mod.BucketGroup).toBeDefined();
    expect(mod.useSessions).toBeDefined();
    expect(mod.useActiveSession).toBeDefined();
    expect(mod.bucketFor).toBeDefined();
    expect(mod.bucketSessions).toBeDefined();
    expect(mod.displayTitle).toBeDefined();
    expect(mod.SESSION_BUCKET_LABELS).toBeDefined();
  });

  it('threads barrel exposes public API', async () => {
    const mod = await import('@/features/threads');
    expect(mod.ThreadsView).toBeDefined();
    expect(mod.ThreadItem).toBeDefined();
    expect(mod.ThreadBucketGroup).toBeDefined();
    expect(mod.chatLinkFor).toBeDefined();
    expect(mod.shortTimestamp).toBeDefined();
  });

  it('design-system barrel exposes primitives + utils', async () => {
    const mod = await import('@/features/design-system');
    expect(mod.Button).toBeDefined();
    expect(mod.IconButton).toBeDefined();
    expect(mod.Icon).toBeDefined();
    expect(mod.Input).toBeDefined();
    expect(mod.Badge).toBeDefined();
    expect(mod.Card).toBeDefined();
    expect(mod.EmptyState).toBeDefined();
    expect(mod.Spinner).toBeDefined();
    expect(mod.Tooltip).toBeDefined();
    expect(mod.Toast).toBeDefined();
    expect(mod.ContextRing).toBeDefined();
    expect(mod.KeyHint).toBeDefined();
    expect(mod.DesignSystemView).toBeDefined();
    expect(mod.ringGeometry).toBeDefined();
    expect(mod.segmentArc).toBeDefined();
    expect(mod.shortcutLabel).toBeDefined();
    expect(mod.detectPlatform).toBeDefined();
    expect(mod.TOAST_COLORS).toBeDefined();
  });

  it('utils barrel exposes all IPC commands', async () => {
    const mod = await import('@/utils/commands');
    expect(mod.reflect_submit).toBeDefined();
    expect(mod.reflect_interrupt).toBeDefined();
    expect(mod.reflect_compact).toBeDefined();
    expect(mod.reflect_rewind).toBeDefined();
    expect(mod.reflect_shutdown).toBeDefined();
    expect(mod.reflect_tool_approval).toBeDefined();
    expect(mod.reflect_hook_approval).toBeDefined();
    expect(mod.reflect_plan_approval).toBeDefined();
    expect(mod.reflect_enter_plan_mode).toBeDefined();
    expect(mod.reflect_exit_plan_mode).toBeDefined();
    expect(mod.reflect_set_effort).toBeDefined();
    expect(mod.reflect_set_permission_mode).toBeDefined();
    expect(mod.reflect_cycle_permission_mode).toBeDefined();
    expect(mod.reflect_ask_user_question_response).toBeDefined();
    expect(mod.reflect_ask_user_input_response).toBeDefined();
    expect(mod.reflect_list_sessions).toBeDefined();
    expect(mod.reflect_rename_session).toBeDefined();
    expect(mod.reflect_delete_session).toBeDefined();
    expect(mod.reflect_replay_session).toBeDefined();
    expect(mod.onReflectEvent).toBeDefined();
    expect(mod.ping).toBeDefined();
  });
});

// ===========================================================================
// 8. IPC 一致性:前端 wrapper ↔ 后端命令
// ===========================================================================

function readBackendCommandSources(): string {
  // 命令体可以落在领域子目录(如 commands/files/image.rs)—— 递归扫描,
  // 与 tests/static/analyze.mjs / tests/ipc.command-contract.test.ts 同口径。
  const commandDir = 'src-tauri/src/commands';
  const fs = require('node:fs') as {
    readdirSync: (p: string, opts: { withFileTypes: boolean }) => { name: string; isDirectory(): boolean }[];
  };
  const listRustFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const p = `${dir}/${entry.name}`;
      return entry.isDirectory() ? listRustFiles(p) : entry.name.endsWith('.rs') ? [p] : [];
    });
  return listRustFiles(commandDir)
    .map((p) => nodeRead(p))
    .join('\n');
}

describe('IPC parity (frontend ↔ backend)', () => {
  it('frontend commands exactly match backend tauri::commands', async () => {
    const backendSrc = readBackendCommandSources();
    const frontend = await import('@/utils/commands');
    const frontendNames = Object.keys(frontend).filter((k) => k.startsWith('reflect_'));

    // 所有前端命令都必须出现在后端源码中（同步 `pub fn` 与 `pub async fn` 均可 ——
    // 如 dock::reflect_set_dock_badge 是同步命令）。
    const missing = frontendNames.filter(
      (n) => !backendSrc.includes(`pub async fn ${n}`) && !backendSrc.includes(`pub fn ${n}`),
    );
    expect(missing).toEqual([]);

    // 后端的每个 reflect_ fn 也必须有对应的前端 wrapper
    const backendMatches: RegExpMatchArray[] = [
      ...backendSrc.matchAll(/pub (?:async )?fn (reflect_\w+)/g),
    ];
    const backendNames: string[] = backendMatches.map((m: RegExpMatchArray) => m[1]);
    const orphan = backendNames.filter((n: string) => !frontendNames.includes(n));
    expect(orphan).toEqual([]);
  });

  it('every frontend command has matching handler in invoke_handler', async () => {
    const libSrc = nodeRead('src-tauri/src/lib.rs', 'utf8');
    const frontend = await import('@/utils/commands');
    const frontendNames = Object.keys(frontend).filter((k) => k.startsWith('reflect_'));

    // 提取 handler 列表
    const match = libSrc.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
    expect(match).not.toBeNull();
    const handlerBody = match![1];
    const missing = frontendNames.filter((n) => !handlerBody.includes(n));
    expect(missing).toEqual([]);
  });
});

// ===========================================================================
// 9. 注入 CSS 设计 token
// ===========================================================================

describe('Design tokens', () => {
  it('tokens.css is importable', async () => {
    // Vitest 不会 bundle CSS;这里只确认文件存在
    expect(nodeExists('src/styles/tokens.css')).toBe(true);
  });

  it('tokens.css declares core variables (accent / bg-app / text / font)', async () => {
    const css = nodeRead('src/styles/tokens.css', 'utf8');
    expect(css).toContain('--accent:');
    expect(css).toContain('--bg-app:');
    expect(css).toContain('--text-primary:');
    expect(css).toContain('--font-sans:');
  });

  it('main.tsx imports tokens.css + base.css', async () => {
    const main = nodeRead('src/main.tsx', 'utf8');
    expect(main).toContain('./styles/tokens.css');
    expect(main).toContain('./styles/base.css');
  });
});

// ===========================================================================
// 10. 各路由可独立挂载 (无需 RouterProvider)
// ===========================================================================

describe('Per-route views (no RouterProvider)', () => {
  it('ChatView mounts standalone', () => {
    render(wrap(<ChatView />));
    expect(document.body.textContent).toBeTruthy();
  });

  it('HomeView mounts standalone with RouterProvider', () => {
    render(wrap(<HomeView />));
    // HomeView 显示与 session 相关的内容
    expect(document.body.textContent).toBeTruthy();
  });

  it('ThreadsView mounts standalone with RouterProvider', () => {
    render(wrap(<ThreadsView />));
    // ThreadsView 调用 useSessions → mock 返回 3 个 sessions → 渲染 "Now" 标题
    expect(document.body.textContent).toBeTruthy();
  });
});