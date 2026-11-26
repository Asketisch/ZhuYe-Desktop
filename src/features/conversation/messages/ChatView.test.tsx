/**
 * ChatView 组件测试 —— 验证会话加载 / 空态 / 错误 / 重试状态。
 *
 * 模拟 @tanstack/react-router 的 `useParams` 控制活动 sessionId，
 * 并模拟 `zhuye_replay_session` 驱动加载 / 错误 / 成功流程。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockInvoke, resetMockInvoke, createTestQueryClient } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { I18nProvider, saveLocale } from '@/utils/i18n';

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ sessionId: window.__chatTestSessionId }),
  useNavigate: () => navigateSpy,
  useLocation: () => ({ pathname: window.__chatTestPath ?? '/chat' }),
  // v1.x:ChatBinding 读 ?sub=<childId>(子代理会话只读查看器)。
  useSearch: () => ({}),
}));

declare global {
  interface Window {
    __chatTestSessionId?: string;
    __chatTestPath?: string;
  }
}

import { ChatView } from './ChatView';
import { ConfirmDialogHost } from '@/features/harness/modals/ConfirmDialog';

// 真实 rollout 线格式:zhuye_protocol::RolloutRecord tagged union。
const T1 = '075f8a83-d84b-4f9d-93eb-9c428881bb43';
const SAMPLE_RECORDS = [
  {
    type: 'session_meta',
    session_id: 'sess-42',
    model: 'anthropic/stub',
    started_at: '2026-08-13T03:01:00Z',
  },
  { type: 'message', turn_id: T1, role: 'user', content: [{ type: 'text', text: 'hello' }] },
  { type: 'message', turn_id: T1, role: 'assistant', content: 'hi! how can I help?' },
];

function renderWithProviders(ui: React.ReactElement) {
  const qc = createTestQueryClient();
  return render(
    <I18nProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </I18nProvider>,
  );
}

describe('ChatView', () => {
  beforeEach(() => {
    resetMockInvoke();
    navigateSpy.mockClear();
    // v1.x:ChatView 加载序列第一步是 bind;默认 mock 为 no-op
    // (resetMockInvoke 会清掉 setup 里的默认 mock,需在本文件重注册)。
    mockInvoke('zhuye_bind_session', async () => ({
      permission_mode: 'auto',
      pending_gates: [],
      prompt_selection: null,
    }));
    saveLocale('en');
    window.__chatTestSessionId = undefined;
    window.__chatTestPath = '/chat';
    useAgentStore.setState({
      turns: [],
      loadedSessionId: null,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingPlan: null,
    } as any);
  });
  afterEach(() => {
    cleanup();
  });

  it('shows loading state, then hydrates turns on successful replay', async () => {
    let resolveReplay!: (records: typeof SAMPLE_RECORDS) => void;
    mockInvoke('zhuye_replay_session', async () => new Promise((resolve) => { resolveReplay = resolve; }));
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });

    // 回放挂起期间应显示加载横幅。
    await waitFor(() => {
      expect(screen.getByText(/^Loading session…$/)).toBeDefined();
    });

    // 解决回放并验证本地状态水合。
    await act(async () => {
      resolveReplay(SAMPLE_RECORDS);
    });
    await waitFor(() => {
      const state = useAgentStore.getState() as any;
      expect(state.loadedSessionId).toBe('sess-42');
      expect(state.turns.length).toBeGreaterThan(0);
    });

    // 水合后，Viewing 横幅必须渲染，加载状态必须清除。
    await waitFor(() => {
      expect(screen.getByText(/Viewing session/)).toBeDefined();
    });
    expect(screen.queryByText(/^Loading session…$/)).toBeNull();
  });

  it('clears old interactions before the new backend bind finishes', async () => {
    let finish!: (mode: string) => void;
    mockInvoke('zhuye_bind_session', () => new Promise<any>((resolve) => {
      finish = () => resolve({ permission_mode: 'auto', pending_gates: [], prompt_selection: null });
    }));
    useAgentStore.setState({ loadedSessionId: 'old', pendingApprovals: [
      { id: 'approval', kind: 'tool', turnId: 'turn' },
    ] });
    window.__chatTestSessionId = 'new';
    window.__chatTestPath = '/chat/new';
    renderWithProviders(<ChatView />);
    await waitFor(() => expect(finish).toBeDefined());
    expect(useAgentStore.getState().pendingApprovals).toEqual([]);
    await act(async () => { finish('auto'); });
  });

  it('shows the hero (emblem + greeting) for an empty loaded session instead of a banner', async () => {
    mockInvoke('zhuye_replay_session', async () => []);
    window.__chatTestSessionId = 'sess-empty';
    window.__chatTestPath = '/chat/sess-empty';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    // 空会话不再显示「没有消息」横幅 —— 统一进入英雄态（徽记 + 问候语）。
    await waitFor(() => {
      expect(screen.getByTestId('chat-hero-greeting')).toBeDefined();
    });
    expect(screen.queryByText(/This session has no messages/)).toBeNull();
  });

  it('forks the current session from the banner button', async () => {
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    const forkCalls: Array<{ id?: string; branch?: string }> = [];
    mockInvoke('zhuye_fork_session', async (_cmd: string, args?: { id: string; branch: string }) => {
      forkCalls.push(args ?? {});
      return 'child-1';
    });
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    const forkBtn = await waitFor(() => {
      const el = screen.getByTestId('chat-fork');
      expect(el).toBeDefined();
      return el;
    });
    fireEvent.click(forkBtn);
    await waitFor(() =>
      expect(forkCalls).toEqual([
        { id: 'sess-42', branch: 'manual', upToTurnId: null },
      ]),
    );
    // 成功 toast + 成功后子会话 id 已广播（导航由 useActiveSession 承担）。
    await waitFor(() => {
      const toasts = useAgentStore.getState().toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0].message).toContain('child-1');
    });
  });

  it('does not navigate away when an old session fork completes', async () => {
    let finish!: (id: string) => void;
    mockInvoke('zhuye_fork_session', () => new Promise<string>((resolve) => { finish = resolve; }));
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';
    const view = renderWithProviders(<ChatView />);
    fireEvent.click(await screen.findByTestId('chat-fork'));
    await waitFor(() => expect(finish).toBeDefined());
    window.__chatTestSessionId = 'other';
    window.__chatTestPath = '/chat/other';
    view.rerender(<I18nProvider><QueryClientProvider client={createTestQueryClient()}><ChatView /></QueryClientProvider></I18nProvider>);
    await act(async () => { finish('child'); });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('forks up to a specific turn from the per-turn fork button', async () => {
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    const forkCalls: Array<{ id?: string; branch?: string; upToTurnId?: string }> = [];
    mockInvoke('zhuye_fork_session', async (_cmd: string, args?: { id: string; branch: string; upToTurnId: string }) => {
      forkCalls.push(args ?? {});
      return 'child-2';
    });
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';
    // 前序用例的 fork toast 会残留进全局 store,先清空再断言本用例自己的。
    useAgentStore.setState({ toasts: [] } as any);

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    // replay 水合出 turn T1 后,轮尾出现「从此轮 Fork」按钮。
    const turnForkBtn = await waitFor(() => {
      const el = screen.getByTestId(`turn-fork-${T1}`);
      expect(el).toBeDefined();
      return el;
    });
    fireEvent.click(turnForkBtn);
    await waitFor(() =>
      expect(forkCalls).toEqual([
        { id: 'sess-42', branch: 'fork@1', upToTurnId: T1 },
      ]),
    );
    await waitFor(() => {
      const toasts = useAgentStore.getState().toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0].message).toContain('child-2');
    });
  });

  it('does not rewind a different session after a delayed confirmation', async () => {
    const rewind = vi.fn(async () => 'ok');
    mockInvoke('zhuye_rewind', rewind);
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';
    const view = renderWithProviders(<><ChatView /><ConfirmDialogHost /></>);
    fireEvent.click(await screen.findByTestId(`turn-rewind-${T1}`));
    const confirm = await screen.findByTestId('confirm-dialog-confirm');
    window.__chatTestSessionId = 'other';
    window.__chatTestPath = '/chat/other';
    view.rerender(<I18nProvider><QueryClientProvider client={createTestQueryClient()}><ChatView /><ConfirmDialogHost /></QueryClientProvider></I18nProvider>);
    await act(async () => { fireEvent.click(confirm); });
    expect(rewind).not.toHaveBeenCalled();
  });

  it('shows localized error and recovers via Retry button', async () => {
    let attempts = 0;
    mockInvoke('zhuye_replay_session', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('replay failed');
      return SAMPLE_RECORDS;
    });
    window.__chatTestSessionId = 'sess-fail';
    window.__chatTestPath = '/chat/sess-fail';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Could not load this session/)).toBeDefined();
    });

    const retry = await screen.findByText(/^Retry$/);
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => {
      const state = useAgentStore.getState() as any;
      expect(state.loadedSessionId).toBe('sess-fail');
      expect(state.turns.length).toBeGreaterThan(0);
    });
  });

  it('renders Chinese copy after switching locale to zh-CN', async () => {
    saveLocale('zh-CN');
    mockInvoke('zhuye_replay_session', async () => []);
    window.__chatTestSessionId = 'sess-zh';
    window.__chatTestPath = '/chat/sess-zh';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    // 空会话进入英雄态 —— 校验中文问候语副标题。
    await waitFor(() => {
      expect(screen.getByText('有什么想让我帮忙的吗？')).toBeDefined();
    });
  });

  it('binds the backend session before replaying history (bind → replay order)', async () => {
    // mock invoke handler 实际签名为 (cmd, args) —— args 是线上参数对象。
    const order: string[] = [];
    mockInvoke('zhuye_bind_session', async (_cmd: string, args?: { id: string }) => {
      order.push(`bind:${args?.id ?? ''}`);
      return { permission_mode: 'auto', pending_gates: [], prompt_selection: null };
    });
    mockInvoke('zhuye_replay_session', async () => {
      order.push('replay');
      return SAMPLE_RECORDS;
    });
    window.__chatTestSessionId = 'sess-42';
    window.__chatTestPath = '/chat/sess-42';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    await waitFor(() => {
      const state = useAgentStore.getState() as any;
      expect(state.loadedSessionId).toBe('sess-42');
    });
    // v1.x:加载序列必须先 bind(后端线程落到本 session id)再 replay 水合。
    // 水合后 loadedSessionId 变化会触发 effect 重跑一次 → 再 bind 一次
    // (后端幂等短路),故只断言前两步的相对顺序。
    expect(order[0]).toBe('bind:sess-42');
    expect(order[1]).toBe('replay');
  });

  it('re-binds the backend session when switching to another session', async () => {
    // mock invoke handler 签名为 (cmd, args) —— args 是线上参数对象。
    const binds: string[] = [];
    mockInvoke('zhuye_bind_session', async (_cmd: string, args?: { id: string }) => {
      binds.push(args?.id ?? '');
      return { permission_mode: 'auto', pending_gates: [], prompt_selection: null };
    });
    mockInvoke('zhuye_replay_session', async () => []);

    // 首次加载 sess-1 并水合。
    window.__chatTestSessionId = 'sess-1';
    window.__chatTestPath = '/chat/sess-1';
    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    await waitFor(() => {
      expect((useAgentStore.getState() as any).loadedSessionId).toBe('sess-1');
    });
    expect(binds).toContain('sess-1');

    // 切到 sess-2(模拟路由参数变化 + 重新挂载):必须再次 bind,
    // 后端 AgentThread 才会续写到新会话文件。
    cleanup();
    window.__chatTestSessionId = 'sess-2';
    window.__chatTestPath = '/chat/sess-2';
    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    await waitFor(() => {
      expect(binds).toContain('sess-2');
    });
    // bind 顺序:sess-1 在前,sess-2 在后(切会话重绑)。
    expect(binds.indexOf('sess-2')).toBeGreaterThan(binds.indexOf('sess-1'));
  });

  it('clears the loaded session when navigating to /chat (no id)', async () => {
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    window.__chatTestSessionId = 'sess-1';
    window.__chatTestPath = '/chat/sess-1';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });
    await waitFor(() => {
      expect((useAgentStore.getState() as any).loadedSessionId).toBe('sess-1');
    });

    cleanup();
    window.__chatTestSessionId = undefined;
    window.__chatTestPath = '/chat';

    await act(async () => {
      renderWithProviders(<ChatView />);
    });

    await waitFor(() => {
      expect((useAgentStore.getState() as any).loadedSessionId).toBeNull();
    });
  });
});

// ===========================================================================
// 首页工作台英雄态（新对话空态 = 问候语 + 快捷模板 + 居中 Composer）
// ===========================================================================

describe('ChatView hero (new-chat home)', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('zhuye_bind_session', async () => ({
      permission_mode: 'auto',
      pending_gates: [],
      prompt_selection: null,
    }));
    saveLocale('en');
    window.__chatTestSessionId = undefined;
    window.__chatTestPath = '/chat';
    useAgentStore.setState({
      turns: [],
      loadedSessionId: null,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingPlan: null,
    } as any);
  });
  afterEach(() => {
    cleanup();
  });

  it('renders greeting, workspace hint (quick prompts moved to the + menu)', async () => {
    mockInvoke('zhuye_current_workspace', async () => '/Users/me/Code/alpha');

    const { container } = renderWithProviders(<ChatView />);

    expect(screen.getByTestId('chat-hero-greeting')).toBeDefined();
    // 「火中生羽」徽记容器挂载（jsdom 无 2d 上下文，仅验 DOM 结构；四层画布）。
    expect(screen.getByTestId('chat-hero-emblem')).toBeDefined();
    expect(screen.getByTestId('chat-hero-emblem').querySelectorAll('canvas').length).toBe(4);
    await waitFor(() => {
      expect(screen.getByTestId('chat-hero-workspace')).toBeDefined();
    });
    expect(screen.getByTestId('chat-hero-workspace').textContent).toContain('alpha');
    // v1.13:快捷模板 chips 已从首页 Hero 移除 —— 统一收进「+」菜单的
    // 「建议」二级目录（唯一入口）。
    expect(screen.queryByTestId('quick-prompt-explore')).toBeNull();
    expect(screen.queryByTestId('quick-prompt-fix')).toBeNull();
    // 英雄态下 MessageList 仅视觉隐藏（保持 role="log" 挂载）。
    expect(container.querySelector('[data-testid="chat-messages-area"]')?.getAttribute('data-hero')).toBe('on');
  });

  it('prefills the composer draft (no auto-send) from the + menu suggestions submenu', async () => {
    await act(async () => {
      renderWithProviders(<ChatView />);
    });

    // 「+」菜单 → 「建议」二级目录 → 「修复问题」。
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-suggestions'));
    fireEvent.click(screen.getByTestId('composer-plus-suggestion-fix'));
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(input.value).toContain('Fix the following problem');
    });
    // 预填不自动发送：不应产生任何 turn。
    expect(useAgentStore.getState().turns.length).toBe(0);
  });

  it('leaves hero state once the new chat has turns', async () => {
    const { container } = renderWithProviders(<ChatView />);
    expect(screen.getByTestId('chat-hero-greeting')).toBeDefined();

    // 首条消息提交后 turn 乐观出现（此时路由尚未切到 /chat/$id）。
    await act(async () => {
      useAgentStore.setState({ turns: [{ id: 'turn-1', items: [] }] } as any);
    });

    expect(screen.queryByTestId('chat-hero-greeting')).toBeNull();
    expect(container.querySelector('[data-testid="chat-messages-area"]')?.getAttribute('data-hero')).toBe('off');
  });

  it('shows the hero for a loaded session with zero turns (workspace new chat)', async () => {
    // 工作区新建会话：sessionId 已落定、replay 为空 —— 同样进入英雄态。
    mockInvoke('zhuye_replay_session', async () => []);
    window.__chatTestSessionId = 'sess-empty';
    window.__chatTestPath = '/chat/sess-empty';

    const { container } = renderWithProviders(<ChatView />);
    // 直接等英雄态出现（loadedSessionId 落定与 loading 复位存在窗口期）。
    await waitFor(() => {
      expect(screen.getByTestId('chat-hero-emblem')).toBeDefined();
    });

    expect(screen.getByTestId('chat-hero-greeting')).toBeDefined();
    expect(container.querySelector('[data-testid="chat-messages-area"]')?.getAttribute('data-hero')).toBe('on');
    // 空会话横幅让位英雄态，不重复提示。
    expect(screen.queryByText('This session has no messages.')).toBeNull();
  });
});