import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, emitMockEvent, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { setUiPrefs, resetUiPrefsForTests } from '@/utils/uiPrefs';
import { settleConfirm } from '@/logic/harness/modals/confirm';

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
  mockInvoke('zhuye_create_session', async () => {
    useAgentStore.setState({ loadedSessionId: 'sess-stub-new' });
    return 'sess-stub-new';
  });
});

describe('Composer prompt-history integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'zhuye.history.default',
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

describe('Composer + 菜单模式指令前置（plan/goal）', () => {
  it('已有文本时 /plan 前置到最前,而不是追加到末尾', async () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '为三个项目做官网规划' } });

    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-plan'));

    expect(input.value).toBe('/plan 为三个项目做官网规划');
  });

  it('空输入时维持 `/plan ` 待补参数', async () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;

    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-plan'));

    expect(input.value).toBe('/plan ');
  });
});

describe('Composer send shortcut', () => {
  // 注意:不要 resetMockInvoke() —— setup.ts 的 beforeEach 已注册
  // zhuye_list_sessions / zhuye_rename_session 等默认 handler
  // (useSessions 的 useQuery 依赖);mockInvoke 本身即覆盖语义。
  //
  // mock invoke 的 handler 签名为 (cmd, args),其中
  // args = { submission } —— 见 src/utils/commands/agent.ts::zhuye_submit。
  interface Submission {
    id: string;
    op: { type: string; items: unknown[] };
  }
  function trackSubmit(submitted: Submission[]) {
    mockInvoke('zhuye_submit', async (_cmd, args) => {
      const submission = (args as { submission: Submission }).submission;
      submitted.push(submission);
      return submission.id;
    });
  }

  it('keeps the draft when submission fails', async () => {
    mockInvoke('zhuye_submit', async () => { throw new Error('channel closed'); });
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useAgentStore.getState().lastError).toBe('channel closed'));
    expect(input.value).toBe('keep this draft');
    expect(localStorage.getItem('zhuye.draft.__new__')).toBe('keep this draft');
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
    mockInvoke('zhuye_list_dir', async () => ({
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
    mockInvoke('zhuye_list_dir', async () => ({
      root: '/tmp/proj',
      entries: [],
      truncated: false,
    }));
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '@' } });

    await screen.findByText('No matching files.');
  });

  it('「+」菜单的 @ 引用入口追加 @ 并直接打开弹层', async () => {
    mockWorkspaceFiles();
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;

    // 显式入口收编在「+」菜单（占位文案教打字触发）。
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-mention'));

    // 入口直接打开弹层(setState 不触发 onChange, 不能依赖 input 流)。
    await screen.findByTestId('mention-picker');
    expect(input.value).toBe('@');

    // 已有文本且末尾非空白 → 补前导空格。
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-mention'));
    expect(input.value).toBe('hello @');
  });

  it('file attachment is sent as a file UserInputItem', async () => {
    const submitted: Array<{ op: { type: string; items: unknown[] } }> = [];
    mockInvoke('zhuye_submit', async (_cmd, args) => {
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
    mockInvoke('zhuye_interrupt', async () => {
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
    // 百分比收进 tooltip（环上无文字）。
    expect(usage.getAttribute('title')).toContain('4%');
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

  it('会话未开启（无 token 数据）不渲染用量环 —— 空环观感等同加载中', () => {
    renderComposer();
    expect(screen.queryByTestId('composer-context-usage')).toBeNull();
  });
});

describe('Composer queue vs steer (C)', () => {
  function useStreamingTurn() {
    useAgentStore.setState({ turns: [{ id: 't-run', items: [], status: 'streaming' }] });
  }

  function trackSubmit(submitted: unknown[]) {
    mockInvoke('zhuye_submit', async (_cmd, args) => {
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
    mockInvoke('zhuye_interrupt', async () => {
      interrupts.push(1);
      return null;
    });
    const steered: Array<{ items: unknown; priority: unknown }> = [];
    mockInvoke('zhuye_steer', async (_cmd: string, args?: { items: unknown; priority: unknown }) => {
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

    // v1.4 A2 真·转向：不打断当前 turn，消息经 zhuye_steer 注入；
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
    mockInvoke('zhuye_steer', async (_cmd: string, args?: { priority: unknown }) => {
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
// 卡内控制件：权限下拉（PermissionPicker）/ 模型 / 思考深度（EffortPicker）
// ===========================================================================

describe('Composer inline controls', () => {
  it('权限下拉:切模式档走 zhuye_set_permission_mode,完全访问只落偏好', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_set_permission_mode', async (_cmd: string, args?: { mode: string }) => {
      calls.push(args?.mode ?? '');
      return 'ok';
    });
    useAgentStore.setState({ permissionMode: 'auto' });
    renderComposer();

    // 打开菜单 → 切到「询问」→ 命令下发,菜单收起,审批策略重置 auto。
    fireEvent.click(await screen.findByTestId('composer-permission-trigger'));
    fireEvent.click(screen.getByTestId('composer-perm-prompt'));
    await waitFor(() => expect(calls).toEqual(['prompt']));
    expect(screen.queryByTestId('composer-permission-menu')).toBeNull();
    expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('auto');

    // 完全访问只落 per-session 偏好,不改工作模式；切入先过确认弹窗
    // （pub/sub 模态,直接 settle「确认」）。
    fireEvent.click(screen.getByTestId('composer-permission-trigger'));
    fireEvent.click(screen.getByTestId('composer-perm-full_access'));
    await waitFor(() => expect(screen.queryByTestId('composer-permission-menu')).toBeNull());
    act(() => settleConfirm(true));
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('full_access'),
    );
    expect(calls).toEqual(['prompt']);
  });

  it('权限菜单恒为三档:store 残留弃用档也不裸回显', () => {
    // 正常路径下 reducer/sync 两条写入口都经 normalizePermissionMode
    // 归一(见 agentStore.test);这里强制注入弃用档,锁定「菜单只有
    // 询问/自主模式/完全访问三档、不再出现原始字符串回显」的渲染契约。
    useAgentStore.setState({ permissionMode: 'accept_edits' as never });
    renderComposer();
    fireEvent.click(screen.getByTestId('composer-permission-trigger'));
    const menu = screen.getByTestId('composer-permission-menu');
    expect(menu.textContent).not.toContain('accept_edits');
    expect(screen.getByTestId('composer-perm-prompt')).toBeDefined();
    expect(screen.getByTestId('composer-perm-auto')).toBeDefined();
    expect(screen.getByTestId('composer-perm-full_access')).toBeDefined();
  });

  it('lists model groups and switches model via zhuye_set_model', async () => {
    mockInvoke(
      'zhuye_get_config',
      async () =>
        '[active]\ngroup = "demo"\n\n[[model_group]]\nid = "demo"\nlabel = "示例网关"\nendpoint = "openai"\nmodel = "gpt-5"\napi_key = "sk-1"\n\n[[model_group.credentials]]\nlabel = "plan-a"\nmodel = "gpt-5-mini"\n',
    );
    mockInvoke('zhuye_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'demo/gpt-5',
      workspace: '/tmp',
      degraded_reason: null,
    }));
    const calls: Array<{ group: string; model: string; label: string }> = [];
    mockInvoke(
      'zhuye_set_model',
      async (_cmd: string, args?: { group: string; model: string; label?: string }) => {
        calls.push({ group: args?.group ?? '', model: args?.model ?? '', label: args?.label ?? '' });
        return 'demo/gpt-5-mini';
      },
    );
    renderComposer();

    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    fireEvent.change(select, { target: { value: 'cred:demo:plan-a' } });
    // 切换必须携带组内凭据 label —— 后端据此写 [active].credential 钉住。
    await waitFor(() =>
      expect(calls).toEqual([{ group: 'demo', model: 'gpt-5-mini', label: 'plan-a' }]),
    );
  });

  it('pins selection via [active].credential and passes label when switching credentials', async () => {
    // 回归(用户实际配置):同一模型组下的组级默认模型与一条钉住的凭据。
    // 修复前选中态靠 spec 后缀匹配 + 空 model 兜底链,切到 MiniMax 会弹回
    // default;修复后选中态单一事实源是 [active].credential 钉住。
    mockInvoke(
      'zhuye_get_config',
      async () =>
        '[active]\ngroup = "demo"\ncredential = "MiniMax"\n\n[[model_group]]\nid = "demo"\nendpoint = "anthropic"\napi_key = "sk-top"\nmodel = "demo/top"\n\n[[model_group.credentials]]\nlabel = "MiniMax"\napi_key = "sk-mm"\n',
    );
    mockInvoke('zhuye_agent_status', async () => ({
      ready: true,
      has_model: false,
      model: 'stub/test',
      workspace: '/tmp',
      degraded_reason: 'model group configured but no model — pick a model in Settings → Models',
    }));
    const calls: Array<{ group: string; model: string; label: string }> = [];
    mockInvoke(
      'zhuye_set_model',
      async (_cmd: string, args?: { group: string; model: string; label?: string }) => {
        calls.push({ group: args?.group ?? '', model: args?.model ?? '', label: args?.label ?? '' });
        return '';
      },
    );
    renderComposer();

    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    // 钉住 MiniMax → 选中态必须落在 MiniMax(而非兜底链挤回第一个选项)。
    await waitFor(() => expect(select.value).toBe('cred:demo:MiniMax'));
    // 切回组级默认模型:不钉凭据 —— label 必须为空串传给后端。
    fireEvent.change(select, { target: { value: 'group:demo' } });
    await waitFor(() =>
      expect(calls).toEqual([{ group: 'demo', model: 'demo/top', label: '' }]),
    );
    // has_model=false → "stub/test" 占位不得展示(诚实显示"未配置模型")。
    expect(screen.queryByText(/stub\/test/)).toBeNull();
  });

  it('no longer fetches provider models inside the composer', async () => {
    // 「拉取模型列表」收进设置页后,输入框内不出现拉取按钮、不自动拉取、
    // 下拉里也没有接口模型组 —— 只剩组与凭据两级。
    mockInvoke(
      'zhuye_get_config',
      async () =>
        '[active]\ngroup = "demo"\n\n[[model_group]]\nid = "demo"\nendpoint = "openai"\napi_key = "sk-1"\nbase_url = "https://api.example.com/v1"\nmodel = "gpt-5"\n',
    );
    mockInvoke('zhuye_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'demo/gpt-5',
      workspace: '/tmp',
      degraded_reason: null,
    }));
    let listCalls = 0;
    mockInvoke('zhuye_list_provider_models', async () => {
      listCalls += 1;
      return { endpoint: 'openai', models: [{ id: 'gpt-4o', display_name: 'gpt-4o' }] };
    });
    renderComposer();

    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    // 挂载不触发任何拉取。
    expect(listCalls).toBe(0);
    // 拉取按钮已移除。
    expect(screen.queryByTestId('composer-fetch-models')).toBeNull();
    // 下拉里没有接口模型组(model: 前缀选项)。
    expect(Array.from(select.options).some((o) => o.value.startsWith('model:'))).toBe(false);
  });

  it('initializes effort from backend readback and applies changes', async () => {
    mockInvoke('zhuye_get_effort', async () => 'high');
    const calls: string[] = [];
    mockInvoke('zhuye_set_effort', async (_cmd: string, args?: { level: string }) => {
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
    mockInvoke('zhuye_run_shell', () => new Promise((resolve) => { finish = resolve; }));
    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i });
    fireEvent.change(input, { target: { value: '! echo hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(finish).toBeDefined());
    emitMockEvent('zhuye_terminal_output', { session_id: 'early', stream: 'stdout', data: 'one', seq: 1 });
    emitMockEvent('zhuye_terminal_output', { session_id: 'early', stream: 'stdout', data: 'two', seq: 2 });
    emitMockEvent('zhuye_terminal_output', { session_id: 'early', stream: 'exit', data: '0', seq: 3 });
    finish({ id: 'early', command: 'echo hi', cwd: '/tmp' });
    await waitFor(() => expect(screen.getByTestId('bang-run-early').getAttribute('data-status')).toBe('done'));
    emitMockEvent('zhuye_terminal_output', { session_id: 'early', stream: 'stderr', data: 'late error', seq: 4 });
    await waitFor(() => expect(screen.getByTestId('bang-run-early').querySelector('pre')?.textContent).toBe('one\ntwo\nlate error\n'));
  });

  it('runs `! cmd` locally via zhuye_run_shell without submitting to the agent', async () => {
    const runShell: string[] = [];
    const submitted: Array<{ id: string }> = [];
    const trackSubmit = (sink: Array<{ id: string }>) => {
      mockInvoke('zhuye_submit', async (_cmd: string, args?: unknown) => {
        const submission = (args as { submission: { id: string } }).submission;
        sink.push(submission);
        return submission.id;
      });
    };
    mockInvoke('zhuye_run_shell', async (_cmd: string, args?: { cmd: string }) => {
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
    emitMockEvent('zhuye_terminal_output', { session_id: 'shell-bang-1', stream: 'exit', data: '', seq: 1 });
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
      mockInvoke('zhuye_submit', async (_cmd: string, args?: unknown) => {
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

    // 首项 plan（六命令置顶）→ ArrowDown 选中第二项 goal。
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input.value).toBe('/goal '));
    // Enter 被弹层消费，不触发 agent 提交。
    await new Promise((r) => setTimeout(r, 30));
    expect(submitted).toHaveLength(0);
  });
});

describe('Composer 顶栏（工作区 / 分支 / worktree 收进卡内）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAgentStore.getState().reset();
    resetMockInvoke();
    mockInvoke('zhuye_current_workspace', async () => '/Users/me/Code/alpha');
    mockInvoke('zhuye_git_status', async () => ({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      entries: [],
      raw: '',
      is_repo: true,
    }));
    mockInvoke('zhuye_remote_sessions', async () => []);
  });

  it('顶栏在工作区胶囊显示目录、分支胶囊显示分支 + ↑↓', async () => {
    renderComposer();

    // 顶栏查询异步回流 —— 等数据出现再断言(胶囊先于数据渲染)。
    const ws = await screen.findByTestId('composer-workspace-pill');
    await waitFor(() => expect(ws.textContent).toContain('alpha'));
    expect(ws.getAttribute('title')).toBe('/Users/me/Code/alpha');
    const branch = await screen.findByTestId('composer-branch-pill');
    await waitFor(() => expect(branch.textContent).toContain('main'));
    expect(branch.textContent).toContain('↑1');
    expect(branch.textContent).toContain('↓2');
    // git 仓库内显示 worktree 隔离开关。
    expect(screen.getByTestId('composer-worktree-toggle')).toBeDefined();
  });

  it('非 git 仓库时分支胶囊与 worktree 开关隐藏', async () => {
    mockInvoke('zhuye_git_status', async () => ({
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      entries: [],
      raw: '',
      is_repo: false,
    }));
    renderComposer();

    expect(await screen.findByTestId('composer-workspace-pill')).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByTestId('composer-branch-pill')).toBeNull(),
    );
    expect(screen.queryByTestId('composer-worktree-toggle')).toBeNull();
  });

  it('运行位置胶囊显示本地 / 远端主机', async () => {
    renderComposer();
    // 本文件不锁定 locale(jsdom 默认 en)—— 断言跟随英文文案。
    await waitFor(() =>
      expect(screen.getByTestId('composer-runtime-pill').textContent).toContain('Local'),
    );

    resetMockInvoke();
    mockInvoke('zhuye_remote_sessions', async () => [
      { sid: 's1', host: 'dev-box', cwd: '/w', isForeground: true },
    ]);
    mockInvoke('zhuye_git_status', async () => ({
      branch: 'main', upstream: null, ahead: 0, behind: 0, entries: [], raw: '', is_repo: true,
    }));
    renderComposer();
    await waitFor(() =>
      expect(screen.getAllByTestId('composer-runtime-pill').some((el) => el.textContent?.includes('dev-box'))).toBe(true),
    );
  });

  it('双层嵌套布局：顶栏与底栏控件都在外层 surface 内（卡内不再有独立控制条）', async () => {
    renderComposer();

    const surface = await screen.findByTestId('composer-card');
    // 顶栏 + 权限下拉 + 思考深度 + 发送按钮全部收进卡内。
    expect(surface.querySelector('[data-testid="composer-top-bar"]')).not.toBeNull();
    expect(surface.querySelector('[data-testid="composer-permission-trigger"]')).not.toBeNull();
    expect(surface.querySelector('[data-testid="composer-effort-picker"]')).not.toBeNull();
    expect(surface.querySelector('[data-testid="composer-send"]')).not.toBeNull();
    // 旧卡下两行（上下文条 / 控制条）已移除。
    expect(screen.queryByTestId('composer-context-bar')).toBeNull();
    expect(screen.queryByTestId('composer-controls-bar')).toBeNull();
  });
});

describe('Composer worktree 隔离意图（发送时消费）', () => {
  // 顶栏开关只是意图登记；建树发生在发送瞬间：先建隔离 worktree →
  // 切 workspace → 以 worktree 路径作首条提交的 workspace（会话归属由
  // 首条提交携带，与 Git 页「在此开会话」同链路）→ 意图一次性清空。
  beforeEach(() => {
    window.localStorage.clear();
    useAgentStore.getState().reset();
    resetMockInvoke();
    mockInvoke('zhuye_get_effort', async () => 'low');
    // worktree 开关只在 git 仓库内渲染。
    mockInvoke('zhuye_git_status', async () => ({
      branch: 'main', upstream: null, ahead: 0, behind: 0, entries: [], raw: '', is_repo: true,
    }));
  });

  function trackWorktreeSend(opts: { createdId: string }) {
    const calls: { create: Array<{ name?: string; branch?: string }>; workspace: string[]; submit: Array<{ text: string; workspace: string | null }> } = {
      create: [], workspace: [], submit: [],
    };
    mockInvoke('zhuye_create_worktree', async (_cmd: string, args?: { name: string; branch?: string }) => {
      calls.create.push({ name: args?.name, branch: args?.branch });
      return {
        path: `/tmp/alpha-worktrees/${args?.name}`,
        branch: args?.branch ?? args?.name ?? '',
        head: 'fake0000', dirty: false, isolated: true, stranded: false,
      };
    });
    mockInvoke('zhuye_set_workspace', async (_cmd: string, args?: { path: string }) => {
      calls.workspace.push(args?.path ?? '');
    });
    mockInvoke('zhuye_create_session', async () => {
      useAgentStore.setState({ loadedSessionId: opts.createdId });
      return opts.createdId;
    });
    mockInvoke('zhuye_submit', async (_cmd: string, args?: unknown) => {
      const submission = (args as { submission: { id: string; op: { items: Array<{ text?: string }> }; workspace?: string } }).submission;
      calls.submit.push({
        text: submission.op.items[0]?.text ?? '',
        workspace: submission.workspace ?? null,
      });
      return submission.id;
    });
    return calls;
  }

  it('勾选后发送:建 worktree → 切 workspace → 提交携带 worktree 路径 → 意图清空', async () => {
    useAgentStore.setState({ loadedSessionId: null });
    const calls = trackWorktreeSend({ createdId: 'wt-sess-1' });

    renderComposer();
    fireEvent.click(await screen.findByTestId('composer-worktree-toggle').then((el) => el.querySelector('input') as HTMLInputElement));
    await waitFor(() =>
      expect(useAgentStore.getState().worktreeIntent).toEqual({ ref: null }),
    );

    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'run isolated checks' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(calls.submit).toHaveLength(1));
    // 建树带起点分支(undefined = 当前 HEAD),workspace 已切到 worktree。
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].branch).toBeUndefined();
    expect(calls.workspace).toEqual([`/tmp/alpha-worktrees/${calls.create[0].name}`]);
    expect(calls.submit[0].workspace).toBe(`/tmp/alpha-worktrees/${calls.create[0].name}`);
    expect(calls.submit[0].text).toBe('run isolated checks');
    // 意图一次性消费。
    expect(useAgentStore.getState().worktreeIntent).toBeNull();
  });

  it('意图激活时首发斜杠命令被拦截(不建树不提交)', async () => {
    useAgentStore.setState({ loadedSessionId: null, worktreeIntent: { ref: null } });
    const calls = trackWorktreeSend({ createdId: 'wt-sess-2' });

    renderComposer();
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/compact' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await new Promise((r) => setTimeout(r, 30));
    expect(calls.create).toHaveLength(0);
    expect(calls.submit).toHaveLength(0);
    // 意图保留 —— 用户改发普通消息后仍可走建树链路。
    expect(useAgentStore.getState().worktreeIntent).toEqual({ ref: null });
  });
});

describe('Composer 会话聊天栏', () => {
  it('卡片底栏内含「+」入口与模型选择器', async () => {
    mockInvoke('zhuye_get_config', async () => '[active]\nprovider = "openai"\n\n[openai]\nmodel = "gpt-5"\napi_key = "sk-1"\n');
    mockInvoke('zhuye_agent_status', async () => ({
      model: 'openai/gpt-5', has_model: true, degraded_reason: null, ready: true, workspace: '.',
    }));
    renderComposer();

    const card = await screen.findByTestId('composer-card');
    // 「+」入口与模型选择器都在卡片内部（不再是卡片外的独立控制条）。
    expect(card.querySelector('[data-testid="composer-plus"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="composer-model-picker"]')).not.toBeNull();
    // 发送按钮在卡片内。
    expect(card.querySelector('[data-testid="composer-send"]')).not.toBeNull();
  });

  it('「+」菜单的压缩入口走 slash 管线（不把 /compact 当普通文本发给模型）', async () => {
    let compactCalled = false;
    mockInvoke('zhuye_compact', async () => {
      compactCalled = true;
      return 'ok';
    });
    renderComposer();

    fireEvent.click(await screen.findByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-compact'));
    await waitFor(() => expect(compactCalled).toBe(true));
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
    mockInvoke('zhuye_get_effort', async () => 'low');
    mockInvoke('zhuye_agent_status', async () => ({
      has_model: true,
      model: 'stub/test',
      provider: 'local',
      ready: true,
    }));
    mockInvoke('zhuye_enter_goal_mode', async () => 'goal-mode');
    mockInvoke('zhuye_exit_goal_mode', async () => 'goal-exit');
  });

  function trackGoalFlow(opts: { createdId: string }) {
    const calls: { create: number; arm: string[]; submit: string[] } = {
      create: 0,
      arm: [],
      submit: [],
    };
    mockInvoke('zhuye_create_session', async () => {
      calls.create += 1;
      return opts.createdId;
    });
    mockInvoke('zhuye_enter_goal_mode', async (_cmd: string, args?: { goal: string }) => {
      calls.arm.push(args?.goal ?? '');
      return 'goal-mode';
    });
    mockInvoke('zhuye_submit', async (_cmd: string, args?: unknown) => {
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

// ── v1.11 桌面#4:锁定发送的键位提示随动 ──────────────────────────
// 键位行为本体(关时 Enter 换行、⌘/Ctrl+Enter 发送)已在
// useComposerInput.test 覆盖;这里断言**发送按钮提示文案**随开关切换,
// 保证用户看到的键位说明与实际行为一致。
describe('Composer — sendOnEnter hint follows the lock toggle', () => {
  afterEach(() => {
    resetUiPrefsForTests();
  });

  it('shows the locked ⌘/Ctrl+Enter hint when sendOnEnter is off', () => {
    setUiPrefs({ sendOnEnter: false });
    renderComposer();
    const label = screen.getByTestId('composer-send').getAttribute('aria-label') ?? '';
    expect(label).toContain('Ctrl+Enter');
    expect(label).toContain('New line');
  });

  it('发送锁定按钮：点击切换 sendOnEnter 偏好，锁定态高亮', async () => {
    renderComposer();
    const lock = () => screen.getByTestId('composer-send-lock');
    // 默认未锁定（LockOpen，无高亮类）。
    expect(lock().getAttribute('class') ?? '').not.toContain('lockOn');
    fireEvent.click(lock());
    await waitFor(() => expect(lock().getAttribute('class')).toContain('lockOn'));
    // 锁定后 Enter 不发送（换行语义）——草稿保留。
    const input = screen.getByRole('textbox', { name: /message ZhuYe/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'locked draft' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('locked draft');
    // 再点解锁恢复。
    fireEvent.click(lock());
    await waitFor(() => expect(lock().getAttribute('class') ?? '').not.toContain('lockOn'));
  });

  it('default hint is Send (Enter), and switches live when the pref toggles', async () => {
    renderComposer();
    const btn = () => screen.getByTestId('composer-send');
    expect(btn().getAttribute('aria-label') ?? '').toContain('Send (Enter)');
    // 运行中切换偏好(设置页开关的效果)→ 提示文案随动,无需重挂载。
    act(() => {
      setUiPrefs({ sendOnEnter: false });
    });
    await waitFor(() => {
      expect(btn().getAttribute('aria-label') ?? '').toContain('Ctrl+Enter');
    });
    act(() => {
      setUiPrefs({ sendOnEnter: true });
    });
    await waitFor(() => {
      expect(btn().getAttribute('aria-label') ?? '').toContain('Send (Enter)');
    });
  });
});
