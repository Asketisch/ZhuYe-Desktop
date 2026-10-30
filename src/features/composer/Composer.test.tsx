import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, emitMockEvent, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';

// 慢 CI(ubuntu runner)上异步 fetch/渲染链路偶发超过 DTL 默认 1s 窗口,
// 本文件 waitFor 统一放宽到 5s。
configure({ asyncUtilTimeout: 5000 });
import { Composer } from './Composer';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/chat' }),
}));

function renderComposer() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <Composer />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

// 提交会乐观插入 streaming turn，影响后续发送路由（Queue/Steer）
// —— 文件级 beforeEach 保证每个用例都从干净 store 出发。
// 草稿持久化到 localStorage（F），同样需要逐用例清理。
beforeEach(() => {
  window.localStorage.clear();
  useAgentStore.getState().reset();
  // 此文件单独挂载 Composer，模拟路由导航后 ChatView 完成会话绑定。
  mockInvoke('reflect_create_session', async () => {
    useAgentStore.setState({ loadedSessionId: 'sess-stub-new' });
    return 'sess-stub-new';
  });
});

describe('Composer prompt-history integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'reflect.history.default',
      JSON.stringify(['first prompt', 'latest prompt']),
    );
  });

  it('restores the pre-browse draft when ArrowDown leaves history', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'unfinished draft' } });
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('latest prompt');

    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('unfinished draft');
  });

  it('keeps the original draft while browsing multiple history entries', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'original draft' } });
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('first prompt');

    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('latest prompt');
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('original draft');
  });

  it('does not submit while an IME composition is active', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'composing' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(input.value).toBe('composing');
  });
});

describe('Composer drag & drop fallback (DOM)', () => {
  // 非 Tauri(jsdom)下原生订阅降级,nativeDrop=false —— DOM dataTransfer
  // 兜底管线必须保持可用(Tauri 内由 useComposerDragDrop 原生事件接管)。
  it('attaches dropped image files as inline previews', async () => {
    renderComposer();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png',
    });
    fireEvent.drop(screen.getByTestId('composer-card'), {
      dataTransfer: { files: [png], types: ['Files'] },
    });
    await waitFor(() => expect(screen.getByTestId('attachment-bar')).toBeDefined());
    expect(screen.getByTestId('attachment-thumb')).toBeDefined();
  });

  it('attaches dropped non-image files as placeholder chips', async () => {
    renderComposer();
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(screen.getByTestId('composer-card'), {
      dataTransfer: { files: [txt], types: ['Files'] },
    });
    await waitFor(() => expect(screen.getByTestId('attachment-bar')).toBeDefined());
    expect(screen.getByTestId('attachment-bar').textContent).toContain('notes.txt');
    // 非图片没有缩略图。
    expect(screen.queryByTestId('attachment-thumb')).toBeNull();
  });
});

describe('Composer send shortcut', () => {
  // 注意:不要 resetMockInvoke() —— setup.ts 的 beforeEach 已注册
  // reflect_list_sessions / reflect_rename_session 等默认 handler
  // (useSessions 的 useQuery 依赖);mockInvoke 本身即覆盖语义。
  //
  // mock invoke 的 handler 签名为 (cmd, args),其中
  // args = { submission } —— 见 src/utils/commands/agent.ts::reflect_submit。
  interface Submission {
    id: string;
    op: { type: string; items: unknown[] };
  }
  function trackSubmit(submitted: Submission[]) {
    mockInvoke('reflect_submit', async (_cmd, args) => {
      const submission = (args as { submission: Submission }).submission;
      submitted.push(submission);
      return submission.id;
    });
  }

  it('keeps the draft when submission fails', async () => {
    mockInvoke('reflect_submit', async () => { throw new Error('channel closed'); });
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useAgentStore.getState().lastError).toBe('channel closed'));
    expect(input.value).toBe('keep this draft');
    expect(localStorage.getItem('reflect.draft.__new__')).toBe('keep this draft');
  });

  it('submits on plain Enter', async () => {
    const submitted: Submission[] = [];
    trackSubmit(submitted);
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '你好，发送我' } });

    const prevented = fireEvent.keyDown(input, { key: 'Enter' });

    // Enter 被拦截(不走默认换行)并触发一次提交。
    expect(prevented).toBe(false);
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].op.type).toBe('user_input');
    expect(submitted[0].op.items).toEqual([{ type: 'text', text: '你好，发送我' }]);
    // 提交后草稿清空。
    expect(input.value).toBe('');
  });

  it('keeps Ctrl/Cmd+Enter working as a send shortcut', async () => {
    const submitted: Submission[] = [];
    trackSubmit(submitted);
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'cmd enter' } });

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(input.value).toBe('');
  });

  it('does not submit on Shift+Enter (newline path)', () => {
    const submitted: Submission[] = [];
    trackSubmit(submitted);
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'line one' } });

    const prevented = fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    // Shift+Enter 不拦截 —— 浏览器默认行为插入换行;也不触发提交。
    expect(prevented).toBe(true);
    expect(submitted).toHaveLength(0);
    expect(input.value).toBe('line one');
  });

  it('does not submit on empty Enter', () => {
    const submitted: Submission[] = [];
    trackSubmit(submitted);
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitted).toHaveLength(0);
  });
});

describe('Composer @ file mention (v1.x)', () => {
  function mockWorkspaceFiles() {
    mockInvoke('reflect_list_dir', async () => ({
      root: '/tmp/proj',
      entries: [
        { name: 'README.md', path: 'README.md', kind: 'file', size: 10, mtime: 0, depth: 1 },
        { name: 'main.ts', path: 'src/main.ts', kind: 'file', size: 10, mtime: 0, depth: 2 },
        { name: 'src', path: 'src', kind: 'dir', size: 0, mtime: 0, depth: 1 },
      ],
      truncated: false,
    }));
  }

  it('typing @ opens the file picker; picking clears @query and adds a chip', async () => {
    mockWorkspaceFiles();
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    // 空 query → 列出全部文件(按 path 字典序), 便于断言目录被过滤。
    fireEvent.change(input, { target: { value: 'read @' } });

    const picker = await screen.findByTestId('mention-picker');
    expect(picker).toBeDefined();
    expect(screen.getByTestId('mention-file-README.md')).toBeDefined();
    expect(screen.getByTestId('mention-file-main.ts')).toBeDefined();
    // 目录不出现在选项中。
    expect(screen.queryByTestId('mention-file-src')).toBeNull();

    fireEvent.click(screen.getByTestId('mention-file-README.md'));

    // 1. 末尾的 `@` 从草稿清除, 前导空白保留。
    expect(input.value).toBe('read ');
    // 2. 附件条出现 file chip。
    expect(screen.getByTestId('attachment-bar')).toBeDefined();
    expect(screen.getByText(/README\.md/)).toBeDefined();
    // 3. 弹层关闭。
    expect(screen.queryByTestId('mention-picker')).toBeNull();
  });

  it('typing @ with no files shows the empty state', async () => {
    mockInvoke('reflect_list_dir', async () => ({
      root: '/tmp/proj',
      entries: [],
      truncated: false,
    }));
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '@' } });

    await screen.findByText('No matching files.');
  });

  it('toolbar @ button appends @ and opens the picker directly', async () => {
    mockWorkspaceFiles();
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;

    fireEvent.click(screen.getByTestId('composer-attach-mention'));

    // 按钮直接打开弹层(setState 不触发 onChange, 不能依赖 input 流)。
    await screen.findByTestId('mention-picker');
    expect(input.value).toBe('@');

    // 已有文本且末尾非空白 → 补前导空格。
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('composer-attach-mention'));
    expect(input.value).toBe('hello @');
  });

  it('file attachment is sent as a file UserInputItem', async () => {
    const submitted: Array<{ op: { type: string; items: unknown[] } }> = [];
    mockInvoke('reflect_submit', async (_cmd, args) => {
      const s = (args as { submission: { op: { type: string; items: unknown[] } } }).submission;
      submitted.push(s);
      return 'sub-ok';
    });
    mockWorkspaceFiles();
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'look @ma' } });
    fireEvent.click(await screen.findByTestId('mention-file-main.ts'));

    fireEvent.change(input, { target: { value: 'look at this file' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].op.items).toEqual([
      { type: 'text', text: 'look at this file' },
      { type: 'file', path: 'src/main.ts' },
    ]);
    // 提交后附件清空 —— 卸载经一帧 React 状态更新,慢 CI(ubuntu)上
    // 同步断言偶发仍在,改 waitFor 等待消失。
    await waitFor(() => expect(screen.queryByTestId('attachment-bar')).toBeNull());
  });
});

describe('Composer run-state controls (E/C)', () => {
  it('shows a stop button while a turn is running; clicking interrupts', async () => {
    const interrupts: number[] = [];
    mockInvoke('reflect_interrupt', async () => {
      interrupts.push(1);
      return null;
    });
    useAgentStore.setState({
      turns: [{ id: 't1', items: [], status: 'streaming' }],
    });
    renderComposer();

    const stop = screen.getByTestId('composer-stop');
    fireEvent.click(stop);

    await waitFor(() => expect(interrupts).toHaveLength(1));
  });

  it('hides the stop button when no turn is running', () => {
    useAgentStore.setState({
      turns: [{ id: 't1', items: [], status: 'done' }],
    });
    renderComposer();
    expect(screen.queryByTestId('composer-stop')).toBeNull();
  });

  it('renders context usage when tokens and window size are known', () => {
    useAgentStore.setState({
      tokens: {
        input: 3000,
        output: 1000,
        cached: 0,
        cacheWrite: 0,
        total: 4000,
        cost: null,
        sessionCost: 0,
      },
      contextWindowSize: 100000,
    });
    renderComposer();
    const usage = screen.getByTestId('composer-context-usage');
    expect(usage.textContent).toContain('4%');
    expect(usage.getAttribute('data-warn')).toBeNull();
  });

  it('flags warning at ≥80% context usage', () => {
    useAgentStore.setState({
      tokens: {
        input: 85000,
        output: 0,
        cached: 0,
        cacheWrite: 0,
        total: 85000,
        cost: null,
        sessionCost: 0,
      },
      contextWindowSize: 100000,
    });
    renderComposer();
    const usage = screen.getByTestId('composer-context-usage');
    expect(usage.getAttribute('data-warn')).not.toBeNull();
    expect(usage.getAttribute('title')).toMatch(/compact/);
  });

  it('renders no context usage without token data', () => {
    renderComposer();
    expect(screen.queryByTestId('composer-context-usage')).toBeNull();
  });
});

describe('Composer queue vs steer (C)', () => {
  function useStreamingTurn() {
    useAgentStore.setState({ turns: [{ id: 't-run', items: [], status: 'streaming' }] });
  }

  function trackSubmit(submitted: unknown[]) {
    mockInvoke('reflect_submit', async (_cmd, args) => {
      const s = (args as { submission: unknown }).submission;
      submitted.push(s);
      return 'sub-ok';
    });
  }

  it('queues a follow-up message while the turn runs without touching the backend', async () => {
    const submitted: unknown[] = [];
    trackSubmit(submitted);
    useStreamingTurn();
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '排队消息' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useAgentStore.getState().queuedMessages).toHaveLength(1));
    expect(submitted).toHaveLength(0);
    expect(useAgentStore.getState().queuedMessages[0].text).toBe('排队消息');
    // 输入框已清空（消息转入队列气泡）。
    expect(input.value).toBe('');
  });

  it('queue drain auto-submits after the turn completes', async () => {
    const submitted: unknown[] = [];
    trackSubmit(submitted);
    useStreamingTurn();
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '稍后发送' }]);

    // 模拟 turn 收尾（subscribe 回调触发 drainQueue）。
    useAgentStore.setState({ turns: [{ id: 't-run', items: [], status: 'done' }] });
    await useAgentStore.getState().drainQueue();

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
    // drain 走 submitItems：乐观插入的 user_text turn 立即可见。
    const turn = useAgentStore.getState().turns.find((item) => item.id !== 't-run');
    expect(turn?.items[0]).toEqual({ kind: 'user_text', text: '稍后发送' });
  });

  it('steer mode 经 Op::Steer 转向 —— 不中断、不 submit、乐观渲染插话', async () => {
    const submitted: unknown[] = [];
    trackSubmit(submitted);
    const interrupts: number[] = [];
    mockInvoke('reflect_interrupt', async () => {
      interrupts.push(1);
      return null;
    });
    const steered: Array<{ items: unknown; priority: unknown }> = [];
    mockInvoke('reflect_steer', async (_cmd: string, args?: { items: unknown; priority: unknown }) => {
      steered.push({ items: args?.items, priority: args?.priority });
      return 'sub-steer';
    });
    useStreamingTurn();
    renderComposer();

    // 切到 Steer 模式。
    fireEvent.click(screen.getByTestId('composer-mode-switch').children[1]);

    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '转向：改用方案 B' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // v1.4 A2 真·转向：不打断当前 turn，消息经 reflect_steer 注入；
    // 纯文本 → priority 'now'。
    await waitFor(() => expect(steered).toHaveLength(1));
    expect(steered[0].priority).toBe('now');
    expect(interrupts).toHaveLength(0);
    expect(submitted).toHaveLength(0);
    // Steer 不产生队列。
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
    // 注入不发协议事件 —— store 乐观渲染：插话立即出现在运行中的 turn。
    const running = useAgentStore.getState().turns.find((turn) => turn.id === 't-run');
    expect(running?.items.at(-1)).toEqual({ kind: 'user_text', text: '转向：改用方案 B' });
  });

  it('Shift+Cmd+Enter 以反转模式发送（queue → steer,单次真转向）', async () => {
    const submitted: unknown[] = [];
    trackSubmit(submitted);
    const steered: Array<{ priority: unknown }> = [];
    mockInvoke('reflect_steer', async (_cmd: string, args?: { priority: unknown }) => {
      steered.push({ priority: args?.priority });
      return 'sub-steer';
    });
    useStreamingTurn();
    renderComposer();

    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '单次转向' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, metaKey: true });

    await waitFor(() => expect(steered).toHaveLength(1));
    expect(submitted).toHaveLength(0);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
  });
});

// ===========================================================================
// 内联控制条（ComposerControls）：模型 / 思考深度 / 权限模式
// ===========================================================================

describe('Composer inline controls', () => {
  it('switches permission mode from the segmented control', async () => {
    const calls: string[] = [];
    mockInvoke('reflect_set_permission_mode', async (_cmd: string, args?: { mode: string }) => {
      calls.push(args?.mode ?? '');
      return 'ok';
    });
    useAgentStore.setState({ permissionMode: 'prompt' });
    renderComposer();

    // Yolo 段 = bubble（core v1.3 安全基线已废除 blanket bypass）。
    fireEvent.click(screen.getByTestId('composer-perm-bubble'));
    await waitFor(() => expect(calls).toEqual(['bubble']));
    // 当前段高亮来自 store 的 permissionMode（permission_mode_changed 事件回读）。
    expect(screen.getByTestId('composer-perm-prompt').getAttribute('data-active')).toBeDefined();
  });

  it('lists coding plans and switches model via reflect_set_model', async () => {
    mockInvoke(
      'reflect_get_config',
      async () =>
        '[active]\nprovider = "openai"\n\n[openai]\nmodel = "gpt-5"\napi_key = "sk-1"\n\n[[openai.credentials]]\nlabel = "plan-a"\nmodel = "gpt-5-mini"\n',
    );
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'openai/gpt-5',
      workspace: '/tmp',
      degraded_reason: null,
    }));
    const calls: Array<{ provider: string; model: string; label: string }> = [];
    mockInvoke(
      'reflect_set_model',
      async (_cmd: string, args?: { provider: string; model: string; label?: string }) => {
        calls.push({ provider: args?.provider ?? '', model: args?.model ?? '', label: args?.label ?? '' });
        return 'openai/gpt-5-mini';
      },
    );
    renderComposer();

    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    fireEvent.change(select, { target: { value: 'openai/plan-a' } });
    // v1.5:切换必须携带 plan label —— 后端据此写 [active].credential 钉住。
    await waitFor(() =>
      expect(calls).toEqual([{ provider: 'openai', model: 'gpt-5-mini', label: 'plan-a' }]),
    );
  });

  it('pins selection via [active].credential and passes label when switching plans', async () => {
    // 回归(用户实际配置):同 provider 两个空 model plan。修复前选中态靠
    // spec 后缀匹配 + 空 model 兜底链,切到 MiniMax 会弹回 default;
    // 修复后选中态单一事实源是 [active].credential 钉住。
    mockInvoke(
      'reflect_get_config',
      async () =>
        '[active]\nprovider = "anthropic"\ncredential = "MiniMax"\n\n[anthropic]\napi_key = "sk-top"\n\n[[anthropic.credentials]]\nlabel = "MiniMax"\napi_key = "sk-mm"\n',
    );
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: false,
      model: 'stub/test',
      workspace: '/tmp',
      degraded_reason: 'provider configured but no model — pick a plan/model in Settings → Models',
    }));
    const calls: Array<{ provider: string; model: string; label: string }> = [];
    mockInvoke(
      'reflect_set_model',
      async (_cmd: string, args?: { provider: string; model: string; label?: string }) => {
        calls.push({ provider: args?.provider ?? '', model: args?.model ?? '', label: args?.label ?? '' });
        return '';
      },
    );
    renderComposer();

    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    // 钉住 MiniMax → 选中态必须落在 MiniMax(而非兜底链挤回第一个 plan)。
    await waitFor(() => expect(select.value).toBe('anthropic/MiniMax'));
    // 切回顶层隐式 default plan:label='default' 必须原样传给后端。
    fireEvent.change(select, { target: { value: 'anthropic/default' } });
    await waitFor(() =>
      expect(calls).toEqual([{ provider: 'anthropic', model: '', label: 'default' }]),
    );
    // has_model=false → "stub/test" 占位不得展示(诚实显示"未配置模型")。
    expect(screen.queryByText(/stub\/test/)).toBeNull();
  });

  it('fetches models from provider API and switches to one of them', async () => {
    mockInvoke(
      'reflect_get_config',
      async () =>
        '[active]\nprovider = "openai"\n\n[openai]\napi_key = "sk-1"\nbase_url = "https://api.example.com/v1"\n',
    );
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'openai/gpt-5',
      workspace: '/tmp',
      degraded_reason: null,
    }));
    const listCalls: Array<{ baseUrl: string; apiKey: string; endpoint: string }> = [];
    mockInvoke(
      'reflect_list_provider_models',
      async (_cmd: string, args?: { baseUrl: string; apiKey: string; endpoint: string }) => {
        // eslint-disable-next-line no-console
        console.log('PROBE list_provider_models invoked', args);
        listCalls.push({ baseUrl: args?.baseUrl ?? '', apiKey: args?.apiKey ?? '', endpoint: args?.endpoint ?? '' });
        return {
          endpoint: 'openai',
          models: [
            { id: 'gpt-4o', display_name: 'gpt-4o', supports_vision: true },
            { id: 'o1-mini', display_name: 'o1-mini', supports_vision: false },
          ],
        };
      },
    );
    const switchCalls: string[] = [];
    mockInvoke('reflect_set_model', async (_cmd: string, args?: { provider: string; model: string }) => {
      switchCalls.push(args?.model ?? '');
      return 'openai/gpt-4o';
    });
    renderComposer();

    // 按钮 disabled={fetchingModels || !hasPlans}:hasPlans 随 agent_status
    // 异步加载,慢 CI 上 findByTestId 返回时仍是 disabled,click 静默无效
    // (仅 ubuntu 实测)—— 先等按钮可用再点。
    // plans 经异步 get_config 加载后组件重渲染。用 queryAll + 原生
    // disabled 属性轮询(不用 jest-dom 的 toBeDisabled —— 它在本组件
    // 的 label>select+button 结构上行为异常,慢 CI 上偶发永不通过)。
    await waitFor(() => {
      const btn = screen.queryByTestId('composer-fetch-models') as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn?.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('composer-fetch-models'));
    await waitFor(() =>
      expect(listCalls).toEqual([{ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-1', endpoint: 'openai' }]),
    );
    // eslint-disable-next-line no-console
    console.log('STEP5: listCalls ok');
    // 拉取结果进入下拉(带能力标记);选择后以该 model id 走 reflect_set_model。
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => o.value === 'model:gpt-4o');
    expect(option?.textContent).toContain('gpt-4o · vision');
    fireEvent.change(screen.getByTestId('composer-model-select'), { target: { value: 'model:gpt-4o' } });
    await waitFor(() => expect(switchCalls).toEqual(['gpt-4o']));
  });

  it('initializes effort from backend readback and applies changes', async () => {
    mockInvoke('reflect_get_effort', async () => 'high');
    const calls: string[] = [];
    mockInvoke('reflect_set_effort', async (_cmd: string, args?: { level: string }) => {
      calls.push(args?.level ?? '');
      return 'ok';
    });
    renderComposer();

    const select = (await screen.findByTestId('composer-effort-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('high'));
    fireEvent.change(select, { target: { value: 'low' } });
    await waitFor(() => expect(calls).toContain('low'));
  });
});

// ===========================================================================
// P3：`!` 终端直通 + slash 弹层键盘导航与 stub 下架
// ===========================================================================

describe('Composer bang (!) shell passthrough', () => {
  it('retains output and exit events arriving before the shell response', async () => {
    let finish!: (session: { id: string; command: string; cwd: string }) => void;
    mockInvoke('reflect_run_shell', () => new Promise((resolve) => { finish = resolve; }));
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i });
    fireEvent.change(input, { target: { value: '! echo hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(finish).toBeDefined());
    emitMockEvent('reflect_terminal_output', { session_id: 'early', stream: 'stdout', data: 'one', seq: 1 });
    emitMockEvent('reflect_terminal_output', { session_id: 'early', stream: 'stdout', data: 'two', seq: 2 });
    emitMockEvent('reflect_terminal_output', { session_id: 'early', stream: 'exit', data: '0', seq: 3 });
    finish({ id: 'early', command: 'echo hi', cwd: '/tmp' });
    await waitFor(() => expect(screen.getByTestId('bang-run-early').getAttribute('data-status')).toBe('done'));
    emitMockEvent('reflect_terminal_output', { session_id: 'early', stream: 'stderr', data: 'late error', seq: 4 });
    await waitFor(() => expect(screen.getByTestId('bang-run-early').querySelector('pre')?.textContent).toBe('one\ntwo\nlate error\n'));
  });

  it('runs `! cmd` locally via reflect_run_shell without submitting to the agent', async () => {
    const runShell: string[] = [];
    const submitted: Array<{ id: string }> = [];
    const trackSubmit = (sink: Array<{ id: string }>) => {
      mockInvoke('reflect_submit', async (_cmd: string, args?: unknown) => {
        const submission = (args as { submission: { id: string } }).submission;
        sink.push(submission);
        return submission.id;
      });
    };
    mockInvoke('reflect_run_shell', async (_cmd: string, args?: { cmd: string }) => {
      runShell.push(args?.cmd ?? '');
      return { id: 'shell-bang-1', command: args?.cmd ?? '', cwd: '/tmp' };
    });
    trackSubmit(submitted);
    renderComposer();

    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '! echo hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(runShell).toEqual(['echo hi']));
    // 不进 agent 循环。
    await new Promise((r) => setTimeout(r, 30));
    expect(submitted).toHaveLength(0);
    // 本地输出面板出现。
    expect(screen.getByTestId('composer-bang-runs').textContent).toContain('! echo hi');
    // exit 事件收尾 → done。
    emitMockEvent('reflect_terminal_output', { session_id: 'shell-bang-1', stream: 'exit', data: '', seq: 1 });
    await waitFor(() => expect(screen.getByText('done')).toBeDefined());
  });
});

describe('Composer slash popup (stub 下架 + 键盘导航)', () => {
  it('hides no-op stub commands from the popup', async () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/' } });

    const popup = await screen.findByTestId('slash-popup');
    expect(popup.textContent).toContain('/effort');
    expect(popup.textContent).toContain('/compact');
    // 纯 TUI 镜像 stub（/theme /vim）已从清单删除,不再出现。
    expect(popup.textContent).not.toContain('/theme');
    expect(popup.textContent).not.toContain('/vim');
    // Tier C no-op stub 不再出现在弹层（手输仍会得到引导提示）。
    expect(popup.textContent).not.toContain('/commit');
    expect(popup.textContent).not.toContain('/review');
    expect(popup.textContent).not.toContain('/mcp');
  });

  it('navigates candidates with ArrowDown and picks with Enter instead of submitting', async () => {
    const submitted: Array<{ id: string }> = [];
    const trackSubmit = (sink: Array<{ id: string }>) => {
      mockInvoke('reflect_submit', async (_cmd: string, args?: unknown) => {
        const submission = (args as { submission: { id: string } }).submission;
        sink.push(submission);
        return submission.id;
      });
    };
    trackSubmit(submitted);
    renderComposer();

    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/' } });
    await screen.findByTestId('slash-popup');

    // 首项 effort → ArrowDown 选中第二项 compact。
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input.value).toBe('/compact '));
    // Enter 被弹层消费，不触发 agent 提交。
    await new Promise((r) => setTimeout(r, 30));
    expect(submitted).toHaveLength(0);
  });
});

describe('Composer context bar (workspace + git branch)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAgentStore.getState().reset();
    resetMockInvoke();
    mockInvoke('reflect_current_workspace', async () => '/Users/me/Code/alpha');
    mockInvoke('reflect_git_status', async () => ({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      entries: [],
      raw: '',
      is_repo: true,
    }));
  });

  it('shows opened directory and branch below the composer', async () => {
    renderComposer();

    // 目录段：basename + hover 全路径；分支段：名称 + ↑↓ 领先/落后。
    const ws = await screen.findByTestId('composer-workspace');
    expect(ws.textContent).toContain('alpha');
    expect(ws.getAttribute('title')).toBe('/Users/me/Code/alpha');
    const branch = await screen.findByTestId('composer-branch');
    expect(branch.textContent).toContain('main');
    expect(branch.textContent).toContain('↑1');
    expect(branch.textContent).toContain('↓2');
  });

  it('hides the branch segment outside a git repo', async () => {
    mockInvoke('reflect_git_status', async () => ({
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      entries: [],
      raw: '',
      is_repo: false,
    }));
    renderComposer();

    expect(await screen.findByTestId('composer-workspace')).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByTestId('composer-branch')).toBeNull(),
    );
  });
});

describe('Composer /goal — 开目标会话', () => {
  // 回归背景：core 的 EnterGoalMode 只挂载自校验控制器、不启动 turn,
  // 旧实现在首页直接把它提交给幽灵线程 —— 无会话、无消息、无反馈。
  // 现在的契约：ensure(建会话+导航+等 bind) → arm → 以目标文本为首条
  // 消息提交 → goalActive 投影亮起。
  beforeEach(() => {
    window.localStorage.clear();
    useAgentStore.getState().reset();
    resetMockInvoke();
    mockInvoke('reflect_get_effort', async () => 'low');
    mockInvoke('reflect_agent_status', async () => ({
      has_model: true,
      model: 'stub/test',
      provider: 'local',
      ready: true,
    }));
    mockInvoke('reflect_enter_goal_mode', async () => 'goal-mode');
    mockInvoke('reflect_exit_goal_mode', async () => 'goal-exit');
  });

  function trackGoalFlow(opts: { createdId: string }) {
    const calls: { create: number; arm: string[]; submit: string[] } = {
      create: 0,
      arm: [],
      submit: [],
    };
    mockInvoke('reflect_create_session', async () => {
      calls.create += 1;
      return opts.createdId;
    });
    mockInvoke('reflect_enter_goal_mode', async (_cmd: string, args?: { goal: string }) => {
      calls.arm.push(args?.goal ?? '');
      return 'goal-mode';
    });
    mockInvoke('reflect_submit', async (_cmd: string, args?: unknown) => {
      const submission = (args as { submission: { id: string; op: { type: string; items: Array<{ type: string; text?: string }> } } }).submission;
      const first = submission.op.items[0];
      calls.submit.push(first?.text ?? '');
      return submission.id;
    });
    return calls;
  }

  it('creates a session, arms the verifier and submits the goal as the first message', async () => {
    // ensureSessionReady 轮询 loadedSessionId —— 预置为即将创建的 id,
    // 模拟 ChatView bind → hydrate 已完成（真实应用中由 ChatView 驱动）。
    useAgentStore.setState({ loadedSessionId: 'goal-sess-1' });
    const calls = trackGoalFlow({ createdId: 'goal-sess-1' });

    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/goal make all tests pass' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(calls.submit).toHaveLength(1));
    expect(calls.create).toBe(1);
    // 顺序敏感：先 arm（校验器在 turn 结束前就位）再发首条消息。
    expect(calls.arm).toEqual(['make all tests pass']);
    expect(calls.submit[0]).toBe('make all tests pass');
    // 前端投影亮起,composer 出现 🎯 徽标。
    expect(useAgentStore.getState().goalActive).toBe(true);
    await waitFor(() => expect(screen.getByTestId('composer-goal-badge')).toBeDefined());
  });

  it('clears the goal projection via /goal clear', async () => {
    useAgentStore.setState({ loadedSessionId: 'goal-sess-1' });
    const calls = trackGoalFlow({ createdId: 'goal-sess-1' });
    useAgentStore.getState().setGoalActive(true);

    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/goal clear' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useAgentStore.getState().goalActive).toBe(false));
    // clear 不建会话、不发消息。
    expect(calls.create).toBe(0);
    expect(calls.arm).toHaveLength(0);
    expect(calls.submit).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId('composer-goal-badge')).toBeNull());
  });
});
