/**
 * Vitest — MessageList 组件测试(阶段 3b:items 模型)。
 *
 * MessageList 直接从 useAgentStore 读 state,测试通过 store API 注入 state。
 *
 * 验证:
 * 1. 渲染空状态
 * 2. 显示 session 等待信息
 * 3. 渲染 user_text + assistant_text items
 * 4. 渲染 tool_call + error items
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MessageList } from '@/features/messages/MessageList';
import { createTestQueryClient } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('MessageList', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders empty state initially', () => {
    render(wrap(<MessageList />));
    expect(screen.getByText(/Start a conversation/i)).toBeDefined();
  });

  it('shows empty-state hint when no turns (no session yet)', () => {
    render(wrap(<MessageList />));
    expect(screen.getByText(/Start a conversation/i)).toBeDefined();
  });

  it('renders user_text + assistant_text items', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [
            { kind: 'user_text', text: 'hello' },
            { kind: 'assistant_text', text: 'Hi there!', streaming: false },
          ],
        },
      ],
      session: { model: 'stub/test', provider: 'local' },
    });
    render(wrap(<MessageList />));
    expect(screen.getByText('hello')).toBeDefined();
    expect(screen.getByText('Hi there!')).toBeDefined();
  });

  it('rewind button appears on done turns and fires onRewindTurn with turn id', () => {
    const onRewind = vi.fn();
    useAgentStore.setState({
      turns: [
        { id: 't1', status: 'done', items: [{ kind: 'user_text', text: 'first' }] },
        { id: 't2', status: 'streaming', items: [{ kind: 'user_text', text: 'second' }] },
      ],
    });
    render(wrap(<MessageList onRewindTurn={onRewind} />));
    // 已结束的 turn 有 rewind 入口;streaming turn 没有(rollout 未落全)。
    const btn = screen.getByTestId('turn-rewind-t1');
    expect(btn).toBeDefined();
    expect(screen.queryByTestId('turn-rewind-t2')).toBeNull();
    fireEvent.click(btn);
    expect(onRewind).toHaveBeenCalledWith('t1');
  });

  it('rewind button hidden when onRewindTurn not provided', () => {
    useAgentStore.setState({
      turns: [{ id: 't1', status: 'done', items: [{ kind: 'user_text', text: 'first' }] }],
    });
    render(wrap(<MessageList />));
    expect(screen.queryByTestId('turn-rewind-t1')).toBeNull();
  });

  // ── v1.11 F7+D6:编辑历史消息入口 ────────────────────────────────

  it('edit button appears only on editable turns and fires onEditTurn with turn id', () => {
    const onEdit = vi.fn();
    useAgentStore.setState({
      turns: [
        // 有用户文本 → 可编辑。
        { id: 't1', status: 'done', items: [{ kind: 'user_text', text: 'first' }] },
        // 无用户文本(纯助手回复)→ 不可编辑。
        { id: 't2', status: 'done', items: [{ kind: 'assistant_text', text: 'answer' }] },
        // streaming 中 → 不给动作入口(rollout 未落全)。
        { id: 't3', status: 'streaming', items: [{ kind: 'user_text', text: 'third' }] },
      ],
    });
    render(wrap(<MessageList onRewindTurn={() => {}} onEditTurn={onEdit} />));
    const btn = screen.getByTestId('turn-edit-t1');
    expect(btn).toBeDefined();
    expect(screen.queryByTestId('turn-edit-t2')).toBeNull();
    expect(screen.queryByTestId('turn-edit-t3')).toBeNull();
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledWith('t1');
  });

  it('edit button hidden when onEditTurn not provided', () => {
    useAgentStore.setState({
      turns: [{ id: 't1', status: 'done', items: [{ kind: 'user_text', text: 'first' }] }],
    });
    render(wrap(<MessageList onRewindTurn={() => {}} />));
    expect(screen.queryByTestId('turn-edit-t1')).toBeNull();
  });

  it('renders tool_call row with status badge', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't2',
          status: 'streaming',
          items: [
            { kind: 'user_text', text: 'list files' },
            {
              kind: 'tool_call',
              toolName: 'bash',
              callId: 'c1',
              argsSummary: 'ls',
              status: 'done',
            },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    // tool_call 行使用 <ToolCell>，它在独立 span 中渲染工具名与摘要。
    const cell = document.querySelector('[data-tool="bash"]');
    expect(cell).not.toBeNull();
    expect(cell!.getAttribute('data-status')).toBe('done');
  });

  it('renders error item as red banner', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't3',
          status: 'done',
          items: [
            { kind: 'user_text', text: 'go' },
            { kind: 'error', text: 'something broke' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    expect(screen.getByText(/something broke/)).toBeDefined();
  });

  it('renders diff outputs through DiffViewer with the file path as label', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't4',
          status: 'done',
          items: [
            {
              kind: 'tool_output',
              callId: 'c2',
              text: 'wrote 12 bytes',
              diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new',
              path: 'src/a.ts',
              isError: false,
            },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    expect(screen.getByText('src/a.ts')).toBeDefined();
    expect(document.querySelector('[data-testid="diff-viewer"]')).not.toBeNull();
  });

  it('merges paired tool_call + tool_output into one cell', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't5',
          status: 'done',
          items: [
            { kind: 'user_text', text: 'run' },
            { kind: 'tool_call', toolName: 'bash', callId: 'c1', argsSummary: '{"command":"ls"}', status: 'done' },
            { kind: 'tool_call', toolName: 'bash', callId: 'c2', argsSummary: '{"command":"pwd"}', status: 'done' },
            { kind: 'tool_output', callId: 'c1', text: 'file-a', isError: false },
            { kind: 'tool_output', callId: 'c2', text: '/tmp', isError: false },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    // 连续两次调用聚合成组,默认折叠 —— 组内逐条单元不渲染。
    const group = screen.getByTestId('tool-group');
    expect(group).toBeDefined();
    expect(document.querySelectorAll('[data-tool="bash"]')).toHaveLength(0);
    // 展开组后,每对 call+output 一个框,共 2 个（而非 2 调用 + 2 输出 = 4 个盒子）。
    fireEvent.click(group.querySelector('button')!);
    const cells = document.querySelectorAll('[data-tool="bash"]');
    expect(cells).toHaveLength(2);
    fireEvent.click(cells[0].querySelector('button')!);
    const section = cells[0].querySelector('[data-testid="tool-cell-output"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('file-a');
    // 未展开的第二个框不显示输出。
    expect(cells[1].querySelector('[data-testid="tool-cell-output"]')).toBeNull();
  });

  it('groups consecutive tool calls into one collapsed summary row', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't7',
          status: 'done',
          items: [
            { kind: 'tool_call', toolName: 'shell', callId: 'g1', argsSummary: '{"command":"ls"}', status: 'done' },
            { kind: 'tool_call', toolName: 'read_file', callId: 'g2', argsSummary: '{"path":"/a.ts"}', status: 'done' },
            { kind: 'tool_call', toolName: 'shell', callId: 'g3', argsSummary: '{"command":"pwd"}', status: 'done' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    // 摘要行写明用到的工具（去重保序）。
    const group = screen.getByTestId('tool-group');
    expect(group.textContent).toContain('shell');
    expect(group.textContent).toContain('read_file');
    // 默认折叠：只有一行摘要,组内单元不渲染。
    expect(document.querySelectorAll('[data-tool]')).toHaveLength(0);
    expect(screen.queryByTestId('tool-group-body')).toBeNull();
  });

  it('组内出现 diff 输出后自动展开（改动不被折叠藏起来）', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't8',
          status: 'streaming',
          items: [
            { kind: 'tool_call', toolName: 'write_file', callId: 'd1', argsSummary: '{"path":"a.ts"}', status: 'done' },
            { kind: 'tool_call', toolName: 'write_file', callId: 'd2', argsSummary: '{"path":"b.ts"}', status: 'done' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    expect(screen.queryByTestId('tool-group-body')).toBeNull();

    // 输出后到：其中一条带 diff → 组自动展开。
    act(() => {
      useAgentStore.setState({
        turns: [
          {
            id: 't8',
            status: 'streaming',
            items: [
              { kind: 'tool_call', toolName: 'write_file', callId: 'd1', argsSummary: '{"path":"a.ts"}', status: 'done' },
              { kind: 'tool_call', toolName: 'write_file', callId: 'd2', argsSummary: '{"path":"b.ts"}', status: 'done' },
              {
                kind: 'tool_output',
                callId: 'd1',
                text: '',
                diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
                path: 'a.ts',
                isError: false,
              },
            ],
          },
        ],
      });
    });
    expect(screen.getByTestId('tool-group-body')).toBeDefined();
    expect(document.querySelector('[data-testid="diff-viewer"]')).not.toBeNull();
  });

  it('思考不打断工具段 —— thinking 与 tool_call 混合聚合成活动组', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't9',
          status: 'done',
          items: [
            { kind: 'tool_call', toolName: 'bash', callId: 'a1', argsSummary: '{"command":"ls"}', status: 'done' },
            { kind: 'thinking', text: '需要先看目录结构' },
            { kind: 'tool_call', toolName: 'bash', callId: 'a2', argsSummary: '{"command":"pwd"}', status: 'done' },
            { kind: 'tool_call', toolName: 'read_file', callId: 'a3', argsSummary: '{"path":"/a.ts"}', status: 'done' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    // 混合段进活动组（而非 tool-group）,默认折叠。
    const group = screen.getByTestId('activity-group');
    expect(group.textContent).toContain('1');
    expect(screen.queryByTestId('tool-group')).toBeNull();
    // 展开:逐条活动(工具格 + 思考行)都在组内。
    fireEvent.click(group.querySelector('button')!);
    const body = screen.getByTestId('activity-group-body');
    expect(body.querySelectorAll('[data-tool="bash"]')).toHaveLength(2);
    // 思考行以折叠块形式在组内(en locale label='thinking';正文在其自身展开层)。
    expect(body.textContent).toContain('thinking');
    // 点思考行展开正文（Collapsible 类名经 CSS Modules hash,以图标颜色档定位）。
    const thinkingRow = body.querySelector('[data-accent="info"] > button, [data-accent="success"] > button') as HTMLButtonElement | null;
    expect(thinkingRow).not.toBeNull();
    fireEvent.click(thinkingRow!);
    expect(body.textContent).toContain('需要先看目录结构');
  });

  it('思考-only 段不套活动组壳 —— 保持独立思考折叠块', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't10',
          status: 'done',
          items: [
            { kind: 'thinking', text: '纯推理,没有任何工具调用' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    expect(screen.queryByTestId('activity-group')).toBeNull();
    // 思考行仍在(折叠态),文字在展开层。
    expect(screen.queryByTestId('activity-group-body')).toBeNull();
  });

  it('defaults merged diff outputs to open without a click', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't6',
          status: 'done',
          items: [
            { kind: 'tool_call', toolName: 'write_file', callId: 'c9', argsSummary: '{"path":"a.ts"}', status: 'done' },
            {
              kind: 'tool_output',
              callId: 'c9',
              text: '',
              diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
              path: 'a.ts',
              isError: false,
            },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    // diff 输出默认展开（沿用旧独立 diff 框的行为）。
    expect(document.querySelector('[data-testid="tool-cell-output"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="diff-viewer"]')).not.toBeNull();
  });

  it('offers a per-turn fork button that reports the turn id and 1-based branch name', () => {
    useAgentStore.setState({
      turns: [
        { id: 'turn-a', status: 'done', items: [{ kind: 'user_text', text: 'first' }] },
        { id: 'turn-b', status: 'done', items: [{ kind: 'user_text', text: 'second' }] },
      ],
    });
    const onForkTurn = vi.fn();
    render(wrap(<MessageList onForkTurn={onForkTurn} />));
    fireEvent.click(screen.getByTestId('turn-fork-turn-b'));
    expect(onForkTurn).toHaveBeenCalledTimes(1);
    expect(onForkTurn).toHaveBeenCalledWith('turn-b', 'fork@2');
  });

  it('hides the per-turn fork button while that turn is still streaming', () => {
    useAgentStore.setState({
      turns: [{ id: 'turn-live', status: 'streaming', items: [{ kind: 'user_text', text: 'live' }] }],
    });
    render(wrap(<MessageList onForkTurn={vi.fn()} />));
    expect(screen.queryByTestId('turn-fork-turn-live')).toBeNull();
  });

  it('renders no per-turn fork buttons without an onForkTurn handler', () => {
    useAgentStore.setState({
      turns: [{ id: 'turn-a', status: 'done', items: [{ kind: 'user_text', text: 'first' }] }],
    });
    render(wrap(<MessageList />));
    expect(screen.queryByTestId('turn-fork-turn-a')).toBeNull();
  });
});

describe('MessageList A2/C1/C2/C3 新增交互', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders user_attachments:图片缩略图 + 文件 chip(A2)', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [
            { kind: 'user_text', text: '看这些' },
            {
              kind: 'user_attachments',
              attachments: [
                { kind: 'image', src: 'data:image/png;base64,AA', mime: 'image/png' },
                { kind: 'file', path: '/ws/src/main.rs', range: { start_line: 1, end_line: 9 } },
              ],
            },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    const thumb = screen.getByTestId('user-attachment-image-0') as HTMLImageElement;
    expect(thumb.querySelector('img')?.src).toBe('data:image/png;base64,AA');
    expect(screen.getByTestId('user-attachment-file-1').textContent).toContain('main.rs');
    expect(screen.getByTestId('user-attachment-file-1').textContent).toContain('L1-L9');
  });

  it('点击缩略图打开 Lightbox,Esc 关闭(B4 联动)', () => {
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [
            { kind: 'user_text', text: 'img' },
            {
              kind: 'user_attachments',
              attachments: [{ kind: 'image', src: 'data:image/png;base64,AA', mime: 'image/png' }],
            },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    fireEvent.click(screen.getByTestId('user-attachment-image-0'));
    expect(screen.getByTestId('lightbox')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('lightbox')).toBeNull();
  });

  it('user/assistant 气泡提供整条复制按钮,复制剥离思考链的正文(C1)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [
            { kind: 'user_text', text: '问一下' },
            { kind: 'assistant_text', text: '<think>隐</think>正式回答' },
          ],
        },
      ],
    });
    render(wrap(<MessageList />));
    fireEvent.click(screen.getByTestId('user-copy'));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('问一下');
    fireEvent.click(screen.getByTestId('assistant-copy'));
    await Promise.resolve();
    // splitAssistantText 剥离 <think> 段,只复制正文。
    expect(writeText).toHaveBeenLastCalledWith('正式回答');
  });

  it('regenerate 按钮仅在含用户内容的已完成轮出现并回调(C2)', () => {
    const onRegenerateTurn = vi.fn();
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [{ kind: 'user_text', text: 'q' }, { kind: 'assistant_text', text: 'a' }],
        },
      ],
    });
    render(wrap(<MessageList onRegenerateTurn={onRegenerateTurn} />));
    fireEvent.click(screen.getByTestId('turn-regenerate-t1'));
    expect(onRegenerateTurn).toHaveBeenCalledWith('t1');
  });

  it('continue 按钮仅在末轮(含助手产出)出现(C3)', () => {
    const onContinueTurn = vi.fn();
    useAgentStore.setState({
      turns: [
        {
          id: 't1',
          status: 'done',
          items: [{ kind: 'user_text', text: 'q1' }, { kind: 'assistant_text', text: 'a1' }],
        },
        {
          id: 't2',
          status: 'done',
          items: [{ kind: 'user_text', text: 'q2' }, { kind: 'assistant_text', text: 'a2' }],
        },
      ],
    });
    render(wrap(<MessageList onContinueTurn={onContinueTurn} />));
    // t1 非末轮:无按钮;t2 末轮:有。
    expect(screen.queryByTestId('turn-continue-t1')).toBeNull();
    fireEvent.click(screen.getByTestId('turn-continue-t2'));
    expect(onContinueTurn).toHaveBeenCalledWith('t2');
  });
});
