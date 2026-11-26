/**
 * src/stores/agentStore.test.ts —— 全部 EventMsg 变体的 reducer 覆盖测试（B1-05）。
 *
 * 每个测试为单个变体构造最小化的 `ZhuyeEvent`，并断言 `reduceEvent`
 * 返回的 patch。本测试文件不演练完整的 store / IPC 层 ——
 * 那由 `src/services/agent.test.ts` 覆盖。目标是**每个变体的
 * reducer 正确性**。
 */
import { describe, it, expect } from 'vitest';
import { reduceEvent, type AgentState } from './agentStore';
import type { ZhuyeEvent, ZhuyeEventMsg } from '@/types/protocol';

// ====== Helpers ======

const emptyState = (): AgentState => ({
  turns: [],
  session: null,
  permissionMode: 'auto',
  pendingApprovals: [],
  pendingQuestions: [],
  pendingAskUser: [],
  pendingElicitations: [],
  pendingPlan: null,
  worktreeIntent: null,
  setWorktreeIntent: () => {},
  contextComposition: null,
  plan: null,
  planDraft: null,
  mcpServers: [],
  lspServers: [],
  lastError: null,
  subscribed: false,
  tokens: null,
  contextWindowSize: null,
  queuedMessages: [],
  planFailover: null,
  compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] },
  collabSessions: [],
  mcpInvocations: [],
  lastRouting: null,
  configReloadedAt: null,
  toasts: [],
  goalActive: false,
  goalSnapshot: null,
  todos: [],
  planSteps: [],
  loadedPlugins: [],
  prompt: null,
  guardStats: null,
  promptPanelOpen: false,
  openPromptPanel: () => {},
  closePromptPanel: () => {},
  setGoalActive: () => {},
  syncGoalSnapshot: async () => {},
  // Actions（reducer 测试中未使用；严格的 AgentState 类型要求它们存在）。
  subscribe: () => () => {},
  submit: async () => {},
  submitItems: async () => {},
  steer: async () => {},
  querySubagents: async () => {},
  interruptSubagent: async () => {},
  promptList: async () => {},
  promptRescan: async () => {},
  queryGuardStats: async () => {},
  subagents: { feed: [], lastStatus: null },
  enqueueMessage: () => {},
  removeQueued: () => {},
  updateQueued: () => {},
  drainQueue: async () => {},
  interrupt: async () => {},
  compact: async () => {},
  rewind: async () => {},
  shutdown: async () => {},
  approve: async () => {},
  approvePlan: async () => {},
  enterPlanMode: async () => {},
  exitPlanMode: async () => {},
  setEffort: async () => {},
  setPermissionMode: async () => {},
  cyclePermissionMode: async () => {},
  syncPermissionMode: () => {},
  answerQuestion: async () => {},
  answerInput: async () => {},
  resolveElicitation: async () => {},
  clearError: () => {},
  pushToast: () => '',
  dismissToast: () => {},
  reset: () => {},
});

const ev = (id: string, msg: ZhuyeEventMsg): ZhuyeEvent => ({ id, msg, seq: 0 });

// ====== Lifecycle (6) ======

describe('reduceEvent — lifecycle', () => {
  it('session_configured sets model+provider', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'session_configured',
        session_id: 's1',
        model: 'claude-opus-4-7',
        provider: 'anthropic',
        approval_policy: 'auto',
        sandbox_policy: 'workspace_only',
      }),
    );
    expect(patch.session).toEqual({ model: 'claude-opus-4-7', provider: 'anthropic' });
  });

  it('session_configured captures context_window_size', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'session_configured',
        session_id: 's1',
        model: 'claude-opus-4-7',
        provider: 'anthropic',
        context_window_size: 200000,
        approval_policy: 'auto',
        sandbox_policy: 'workspace_only',
      }),
    );
    expect(patch.contextWindowSize).toBe(200000);
  });

  it('turn_started creates empty turn if missing', () => {
    const patch = reduceEvent(emptyState(), ev('t1', { type: 'turn_started', turn_id: 't1' }));
    expect(patch.turns).toHaveLength(1);
    expect(patch.turns![0]).toMatchObject({ id: 't1', status: 'streaming', items: [] });
  });

  it('turn_started is idempotent', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [], status: 'streaming' }],
    };
    const patch = reduceEvent(s, ev('t1', { type: 'turn_started', turn_id: 't1' }));
    expect(patch.turns ?? s.turns).toHaveLength(1);
  });

  it('turn_complete marks turn done', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [], status: 'streaming' }],
    };
    const patch = reduceEvent(
      s,
      ev('t1', {
        type: 'turn_complete',
        turn_id: 't1',
        usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, total_tokens: 0 },
        status: 'success',
      }),
    );
    expect(patch.turns![0].status).toBe('done');
  });

  it('turn_aborted marks turn aborted', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [], status: 'streaming' }],
    };
    const patch = reduceEvent(
      s,
      ev('t1', { type: 'turn_aborted', turn_id: 't1', reason: { type: 'user_interrupt' } }),
    );
    expect(patch.turns![0].status).toBe('aborted');
  });

  it('turn_rewound drops the target turn and everything after it', () => {
    // 引擎 `truncate_after(to_turn_id)` 丢弃该 turn 含及其之后(recorder.rs),
    // 本地截断同语义:rewind 到 t2 → 只剩 t1。
    const s: AgentState = {
      ...emptyState(),
      turns: [
        { id: 't1', items: [], status: 'done' },
        { id: 't2', items: [], status: 'done' },
        { id: 't3', items: [], status: 'done' },
      ],
    };
    const patch = reduceEvent(s, ev('', { type: 'turn_rewound', to_turn_id: 't2', truncated_after: 2 }));
    expect(patch.turns).toHaveLength(1);
    expect(patch.turns!.map((t) => t.id)).toEqual(['t1']);
  });

  it('shutdown_complete sets lastError', () => {
    // shutdown_complete 是单元变体（无 payload 字段）。
    const patch = reduceEvent(emptyState(), ev('', { type: 'shutdown_complete' } as never));
    expect(patch.lastError).toBe('agent shut down');
  });

  it('submission_closed is a no-op (serve-mode marker)', () => {
    // v1.3 SDK serve 模式的 per-submission 排空标记;Desktop 内嵌线程
    // 不发,类型联合补齐后 reducer no-op 保穷尽。
    const patch = reduceEvent(emptyState(), ev('sub-1', { type: 'submission_closed' } as never));
    expect(patch).toEqual({});
  });
});

// ====== LLM output (4) ======

describe('reduceEvent — LLM output', () => {
  it('agent_message_delta appends to streaming item', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [{ kind: 'assistant_text', text: 'Hello', streaming: true }], status: 'streaming' }],
    };
    const patch = reduceEvent(s, ev('t1', { type: 'agent_message_delta', delta: ' world' }));
    expect(patch.turns![0].items[0]).toMatchObject({ kind: 'assistant_text', text: 'Hello world', streaming: true });
  });

  it('agent_message_delta creates item if missing', () => {
    const s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    const patch = reduceEvent(s, ev('t1', { type: 'agent_message_delta', delta: 'a' }));
    expect(patch.turns![0].items).toHaveLength(1);
  });

  it('agent_message finalizes streaming text', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [{ kind: 'assistant_text', text: 'abc', streaming: true }], status: 'streaming' }],
    };
    const patch = reduceEvent(s, ev('t1', { type: 'agent_message', text: 'final' }));
    expect(patch.turns![0].items[0]).toMatchObject({ kind: 'assistant_text', text: 'final', streaming: false });
  });

  it('thinking_delta accumulates into thinking item', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: 'Hmm' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: '...' })) };
    expect(s.turns[0].items[0]).toMatchObject({ kind: 'thinking', text: 'Hmm...' });
  });

  it('thinking_delta summary variant opens a new item after raw (F50)', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: 'raw stream' })) };
    s = {
      ...s,
      ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: 'summary text', kind: 'summary' })),
    };
    const items = s.turns[0].items;
    // raw 与 summary 语义不同,应分条
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ kind: 'thinking', text: 'raw stream', variant: 'raw' });
    expect(items[1]).toMatchObject({ kind: 'thinking', text: 'summary text', variant: 'summary' });
  });

  it('thinking_delta same-variant summary accumulates (F50)', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = {
      ...s,
      ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: 'A', kind: 'summary' })),
    };
    s = {
      ...s,
      ...reduceEvent(s, ev('t1', { type: 'thinking_delta', delta: 'B', kind: 'summary' })),
    };
    const items = s.turns[0].items;
    // 同 variant 连续增量应追加
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({ kind: 'thinking', text: 'AB', variant: 'summary' });
  });

  it('token_count updates tokens snapshot', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', {
        type: 'token_count',
        input_tokens: 1200,
        output_tokens: 300,
        cached_tokens: 200,
        cache_write_tokens: 500,
        total_tokens: 1500,
        provider: 'anthropic',
        credential_label: 'main-key',
        model: 'anthropic/claude-sonnet-4',
      }),
    );
    expect(patch.tokens).toEqual({
      input: 1200,
      output: 300,
      cached: 200,
      cacheWrite: 500,
      total: 1500,
      provider: 'anthropic',
      credentialLabel: 'main-key',
      model: 'anthropic/claude-sonnet-4',
      cost: null,
      sessionCost: 0,
      // 会话累计 total(区别于 total = 最后一次调用)。
      sessionTotal: 1500,
      // 本回合累计(按回合归零)。
      turn: {
        turnId: 't1',
        input: 1200,
        output: 300,
        cached: 200,
        cacheWrite: 500,
        total: 1500,
      },
      // 按模型累计(v1.x 模型级统计):首次事件 → 该模型 1 次调用。
      byModel: {
        'anthropic/claude-sonnet-4': {
          model: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          calls: 1,
          input: 1200,
          output: 300,
          cached: 200,
          cacheWrite: 500,
          total: 1500,
          cost: 0,
        },
      },
    });
  });

  it('token_count accumulates per model across events', () => {
    // v1.x 模型级统计:两个模型各一次调用 → byModel 分组累计。
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'token_count',
          input_tokens: 100, output_tokens: 10, cached_tokens: 0,
          cache_write_tokens: 0, total_tokens: 110,
          provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t2', {
          type: 'token_count',
          input_tokens: 200, output_tokens: 20, cached_tokens: 0,
          cache_write_tokens: 0, total_tokens: 220,
          provider: 'openai', model: 'openai/gpt-4o',
        }),
      ),
    };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t3', {
          type: 'token_count',
          input_tokens: 300, output_tokens: 30, cached_tokens: 0,
          cache_write_tokens: 0, total_tokens: 330,
          provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    const byModel = s.tokens!.byModel!;
    expect(Object.keys(byModel)).toHaveLength(2);
    // 同一模型累计 2 次调用。
    expect(byModel['anthropic/claude-sonnet-4']).toMatchObject({
      calls: 2, input: 400, output: 40, total: 440,
    });
    expect(byModel['openai/gpt-4o']).toMatchObject({ calls: 1, total: 220 });
    // 会话累计 total = 110 + 220 + 330。
    expect(s.tokens!.sessionTotal).toBe(660);
  });

  it('回合累计事件(turn_total)不重复累计会话总量与费用', () => {
    // 引擎回合收尾会补发一条 turn_total = true 的累计事件(数字 = 本回合
    // 逐次调用的累计)。它与逐次调用的快照语义不同 —— 一并累计会让会话
    // 总量与费用翻倍(per-call 之和 + 回合累计)。
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'token_count',
          input_tokens: 100, output_tokens: 10, cached_tokens: 40,
          cache_write_tokens: 0, total_tokens: 110,
          cost_usd: 0.002, provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'token_count',
          input_tokens: 200, output_tokens: 20, cached_tokens: 80,
          cache_write_tokens: 0, total_tokens: 220,
          cost_usd: 0.003, provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    // 回合收尾:引擎补发本回合累计(330 = 110 + 220)。
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'token_count',
          input_tokens: 300, output_tokens: 30, cached_tokens: 120,
          cache_write_tokens: 0, total_tokens: 330,
          cost_usd: 0.005, turn_total: true,
        }),
      ),
    };
    // 会话累计只算逐次调用:110 + 220 = 330(不是 660)。
    expect(s.tokens!.sessionTotal).toBe(330);
    // 费用同理:0.002 + 0.003(不是 +0.005)。
    expect(s.tokens!.sessionCost).toBeCloseTo(0.005);
    // 「最后一次调用」的快照不被回合累计覆盖(否则上下文占比失真)。
    expect(s.tokens!.input).toBe(200);
    expect(s.tokens!.total).toBe(220);
    // 本回合累计采用引擎给的权威值。
    expect(s.tokens!.turn).toMatchObject({
      turnId: 't1', input: 300, output: 30, cached: 120, total: 330,
    });
  });

  it('本回合累计按回合归零', () => {
    // 新回合的第一次调用 → 本回合累计从零开始,不接上一回合的数。
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'token_count',
          input_tokens: 100, output_tokens: 10, cached_tokens: 40,
          cache_write_tokens: 0, total_tokens: 110,
          provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t2', {
          type: 'token_count',
          input_tokens: 50, output_tokens: 5, cached_tokens: 10,
          cache_write_tokens: 0, total_tokens: 55,
          provider: 'anthropic', model: 'anthropic/claude-sonnet-4',
        }),
      ),
    };
    expect(s.tokens!.turn).toMatchObject({
      turnId: 't2', input: 50, output: 5, cached: 10, total: 55,
    });
  });

  it('token_count tolerates missing optional provider/credential_label', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', {
        type: 'token_count',
        input_tokens: 10,
        output_tokens: 5,
        cached_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 15,
      }),
    );
    expect(patch.tokens).toMatchObject({
      total: 15,
      provider: null,
      credentialLabel: null,
      cacheWrite: 0,
      // v1.x:旧引擎不上报 model → null。
      model: null,
    });
  });
});

// ====== Tool (2) ======

describe('reduceEvent — tool', () => {
  it('tool_call_begin adds running tool_call', () => {
    const s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    const patch = reduceEvent(
      s,
      ev('t1', { type: 'tool_call_begin', call_id: 'c1', tool_name: 'Bash', args: { cmd: 'ls' } }),
    );
    expect(patch.turns![0].items[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'Bash',
      callId: 'c1',
      status: 'running',
    });
  });

  it('tool_call_args_delta 累积到对应 tool_call 条目(v1.5 流式参数)', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'tool_call_begin', call_id: 'c1', tool_name: 'write_file', args: null })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'tool_call_args_delta', call_id: 'c1', delta: '{"path":"a' })) };
    const patch = reduceEvent(s, ev('t1', { type: 'tool_call_args_delta', call_id: 'c1', delta: '.ts"}' }));
    const item = patch.turns![0].items.find((i) => i.kind === 'tool_call');
    expect(item && item.kind === 'tool_call' && item.argsStream).toBe('{"path":"a.ts"}');
  });

  it('tool_call_args_delta 找不到配对条目时保持原状(乱序/回放宽容)', () => {
    const s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    const patch = reduceEvent(s, ev('t1', { type: 'tool_call_args_delta', call_id: 'ghost', delta: '{}' }));
    expect(patch.turns).toBeUndefined();
  });

  it('tool_call_end marks tool as done and appends output', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'tool_call_begin', call_id: 'c1', tool_name: 'Bash', args: {} })) };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('t1', {
          type: 'tool_call_end',
          call_id: 'c1',
          output: { content: [{ type: 'text', text: 'ok' }], is_error: false, metadata: {}, elapsed_ms: 5 },
          is_error: false,
          elapsed_ms: 5,
        }),
      ),
    };
    const items = s.turns[0].items;
    const callItem = items.find((i) => i.kind === 'tool_call');
    expect(callItem && callItem.kind === 'tool_call' && callItem.status).toBe('done');
    const outItem = items.find((i) => i.kind === 'tool_output');
    // 结构化 ToolOutput 的 text 块被提取为纯文本（不再 JSON 序列化整个对象）。
    expect(outItem && outItem.kind === 'tool_output').toBeTruthy();
    if (outItem && outItem.kind === 'tool_output') {
      expect(outItem.text).toBe('ok');
    }
  });

  it('TodoWrite 工具输出里的 todo 清单被提取到 state.todos', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = {
      ...s,
      ...reduceEvent(s, ev('t1', { type: 'tool_call_begin', call_id: 'c1', tool_name: 'TodoWrite', args: {} })),
    };
    const patch = reduceEvent(
      s,
      ev('t1', {
        type: 'tool_call_end',
        call_id: 'c1',
        output: {
          content: [{ type: 'text', text: 'Wrote 2 todos.' }],
          is_error: false,
          // 核心 `TodoRow` 带 `rename_all = "camelCase"` —— 线上字段是 `activeForm`。
          metadata: {
            todos: [
              { content: 'design schema', status: 'in_progress', activeForm: 'Designing' },
              { content: 'write tests', status: 'pending', activeForm: null },
            ],
            count: 2,
          },
          elapsed_ms: 0,
        },
        is_error: false,
        elapsed_ms: 0,
      }),
    );
    expect(patch.todos).toEqual([
      { content: 'design schema', status: 'in_progress', active_form: 'Designing' },
      { content: 'write tests', status: 'pending', active_form: null },
    ]);
  });

  it('非 TodoWrite 工具不产出 todo 清单', () => {
    let s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    s = {
      ...s,
      ...reduceEvent(s, ev('t1', { type: 'tool_call_begin', call_id: 'c1', tool_name: 'Bash', args: {} })),
    };
    const patch = reduceEvent(
      s,
      ev('t1', {
        type: 'tool_call_end',
        call_id: 'c1',
        output: {
          content: [{ type: 'text', text: 'ok' }],
          is_error: false,
          metadata: { todos: [{ content: 'x', status: 'pending' }] },
          elapsed_ms: 0,
        },
        is_error: false,
        elapsed_ms: 0,
      }),
    );
    expect(patch.todos).toBeUndefined();
  });
});

// ====== 审批 / 提问 / 权限气泡 ======

describe('reduceEvent — approval / ask_user / bubble', () => {
  it('approval_request (tool kind) enqueues pending', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', {
        type: 'approval_request',
        request_id: 'a1',
        kind: { type: 'tool', tool_name: 'Bash', args: { cmd: 'rm -rf /' } },
      }),
    );
    expect(patch.pendingApprovals).toHaveLength(1);
    expect(patch.pendingApprovals![0]).toMatchObject({ id: 'a1', kind: 'tool', toolName: 'Bash' });
  });

  it('approval_request (plan kind) 不进 pendingApprovals —— plan 走独立的 pendingPlan', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', { type: 'approval_request', request_id: 'a2', kind: { type: 'plan', plan_id: 'p1', summary: 'refactor' } }),
    );
    // plan 审批走 plan_ready 事件 + composer 审批条/右 dock 计划页签,不进 tool/hook 的 pendingApprovals。
    expect(patch.pendingApprovals).toBeUndefined();
  });

  it('ask_user_question enqueues', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', { type: 'ask_user_question', request_id: 'q1', questions: [] }),
    );
    expect(patch.pendingQuestions).toHaveLength(1);
    expect(patch.pendingQuestions![0].id).toBe('q1');
  });

  it('ask_user_input enqueues', () => {
    const patch = reduceEvent(emptyState(), ev('t1', { type: 'ask_user_input', request_id: 'i1', prompt: 'why?' }));
    expect(patch.pendingAskUser).toHaveLength(1);
  });

  it('permission_bubble 成为非阻塞 toast,不进 pendingApprovals', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', { type: 'permission_bubble', tool_name: 'Bash', risk: 'high' }),
    );
    // bubble 事件没有 request_id,合成 approval 会渲染成无法应答的 modal。
    expect(patch.pendingApprovals).toBeUndefined();
    expect(patch.toasts![0]).toMatchObject({ kind: 'info', message: '已自动批准 Bash' });
  });
});

// ====== Compaction / Error ======

describe('reduceEvent — compaction / error', () => {
  it('context_compacted 聚合到 compactions 统计,不进对话流', () => {
    const s: AgentState = {
      ...emptyState(),
      turns: [{ id: 't1', items: [], status: 'streaming' }],
      compactions: { count: 1, removedMessages: 2, tokensSaved: 100, last: 'microcompact: 2 msgs', records: [] },
    };
    const patch = reduceEvent(
      s,
      ev('t1', {
        type: 'context_compacted',
        strategy: 'smart_prune',
        removed_messages: 0,
        before_tokens: 7731,
        after_tokens: 5344,
      }),
    );
    expect(patch.turns).toBeUndefined();
    expect(patch.compactions).toMatchObject({
      count: 2,
      removedMessages: 2,
      tokensSaved: 100 + (7731 - 5344),
      last: 'smart_prune: 0 msgs (7731 → 5344 tokens)',
    });
    // 逐次明细:让「压缩省了多少」可核对,不再只有一行 hover 摘要。
    expect(patch.compactions!.records).toHaveLength(1);
    expect(patch.compactions!.records![0]).toMatchObject({
      strategy: 'smart_prune',
      beforeTokens: 7731,
      afterTokens: 5344,
      tokensSaved: 7731 - 5344,
    });
  });

  it('context_compacted 无变化(noop)不计入统计', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('t1', {
        type: 'context_compacted',
        strategy: 'noop',
        removed_messages: 0,
        before_tokens: 500,
        after_tokens: 500,
      }),
    );
    expect(patch.compactions).toBeUndefined();
  });

  it('error (turn) appends formatted text', () => {
    const s: AgentState = { ...emptyState(), turns: [{ id: 't1', items: [], status: 'streaming' }] };
    const patch = reduceEvent(s, ev('t1', { type: 'error', code: 'E_FAIL', message: 'x' }));
    expect(patch.turns![0].items[0]).toMatchObject({ kind: 'error', text: 'E_FAIL: x' });
  });

  it('error (session) sets lastError', () => {
    const patch = reduceEvent(emptyState(), ev('', { type: 'error', code: 'E_FAIL', message: 'x' }));
    expect(patch.lastError).toBe('E_FAIL: x');
  });

  it('stream_error sets lastError with retry info', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'stream_error', code: '429', message: 'rate limited', retry_in_ms: 5000 }),
    );
    expect(patch.lastError).toContain('rate limited');
  });
});

// ====== Config / routing ======

describe('reduceEvent — config / routing', () => {
  it('config_reloaded updates timestamp', () => {
    const before = Date.now();
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'config_reloaded', path: '/cfg', sections_changed: ['anthropic'], at: 0 }),
    );
    expect(patch.configReloadedAt).toBeGreaterThanOrEqual(before);
  });

  it('routing stores snapshot', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'routing',
        kind: 'switched',
        role: 'main',
        from_credential: 'work',
        to_credential: 'personal',
        reason: 'rate_limited',
      }),
    );
    expect(patch.lastRouting).toMatchObject({ kind: 'switched', from: 'work', to: 'personal' });
  });

  it('routing v1.7 spec_fallback(跨模型降级)同样入快照', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'routing',
        kind: 'spec_fallback',
        role: 'main',
        from_credential: 'a/one',
        to_credential: 'b/two',
        reason: 'credential pool exhausted',
      }),
    );
    expect(patch.lastRouting).toMatchObject({ kind: 'spec_fallback', from: 'a/one', to: 'b/two' });
  });
});

// ====== Prompt layers (v1.6.1) ======

describe('reduceEvent — prompt layers', () => {
  it('prompt_list writes available/active layers and current spec', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'prompt_list',
        available: ['claude', 'gpt', 'my-layer'],
        current_spec: 'anthropic/claude-sonnet-4',
        active_layers: ['my-layer'],
      }),
    );
    expect(patch.prompt).toEqual({
      available: ['claude', 'gpt', 'my-layer'],
      currentSpec: 'anthropic/claude-sonnet-4',
      activeLayers: ['my-layer'],
      switchedAt: null,
    });
  });

  it('prompt_switched updates active layers, keeps available, sets timestamp', () => {
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', {
          type: 'prompt_list',
          available: ['claude', 'my-layer'],
          current_spec: 'anthropic/claude-sonnet-4',
          active_layers: [],
        }),
      ),
    };
    const before = Date.now();
    const patch = reduceEvent(
      s,
      ev('', { type: 'prompt_switched', action: 'reload', active_layers: ['my-layer'] }),
    );
    expect(patch.prompt).toMatchObject({
      available: ['claude', 'my-layer'],
      currentSpec: 'anthropic/claude-sonnet-4',
      activeLayers: ['my-layer'],
    });
    expect(patch.prompt!.switchedAt).toBeGreaterThanOrEqual(before);
    // 协议约定:UI 提示「提示词已刷新」→ reducer 附带 toast。
    expect(patch.toasts?.length).toBe(1);
    expect(patch.toasts![0].message).toContain('my-layer');
  });

  it('prompt_switched keeps available list even without a prior prompt_list', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'prompt_switched', action: 'reload', active_layers: [] }),
    );
    expect(patch.prompt).toMatchObject({ available: [], currentSpec: '', activeLayers: [] });
  });

  // v1.13:切会话时前端会下发 Select,引擎必回 prompt_switched —— 但
  // 内容常常完全没变(同一 selection 解析出同一组生效层)。此时不再
  // 弹「提示词已刷新」,否则用户每次切会话都看到一条无意义提示。
  it('prompt_switched 内容未变 → 不弹 toast(仍更新时间戳)', () => {
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', {
          type: 'prompt_switched',
          action: 'select',
          active_layers: ['my-layer'],
          selection: { mode: 'manual', profile: 'my-layer' },
          profile: 'my-layer',
        }),
      ),
    };
    expect(s.toasts?.length).toBe(1);

    const before = Date.now();
    const patch = reduceEvent(
      s,
      ev('', {
        type: 'prompt_switched',
        action: 'select',
        active_layers: ['my-layer'],
        selection: { mode: 'manual', profile: 'my-layer' },
        profile: 'my-layer',
      }),
    );
    expect(patch.toasts).toBeUndefined();
    expect(patch.prompt!.switchedAt).toBeGreaterThanOrEqual(before);
  });

  it('prompt_switched 生效层变化 → 仍弹 toast', () => {
    let s: AgentState = emptyState();
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', { type: 'prompt_switched', action: 'select', active_layers: ['a'] }),
      ),
    };
    const patch = reduceEvent(
      s,
      ev('', { type: 'prompt_switched', action: 'select', active_layers: ['b'] }),
    );
    // 首轮已产生 1 条 toast,变化这轮追加第 2 条。
    expect(patch.toasts?.length).toBe(2);
  });

  it('guard_stats writes the four counters into guardStats (F01)', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'guard_stats',
        enabled: true,
        definitions_blocked: 1,
        definitions_reviewed: 2,
        outputs_blocked: 3,
        outputs_reviewed: 4,
      }),
    );
    expect(patch.guardStats).toEqual({
      enabled: true,
      definitionsBlocked: 1,
      definitionsReviewed: 2,
      outputsBlocked: 3,
      outputsReviewed: 4,
    });
  });

  it('guard_stats with enabled=false keeps zero counters (F01)', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'guard_stats',
        enabled: false,
        definitions_blocked: 0,
        definitions_reviewed: 0,
        outputs_blocked: 0,
        outputs_reviewed: 0,
      }),
    );
    expect(patch.guardStats?.enabled).toBe(false);
    expect(patch.guardStats?.outputsBlocked).toBe(0);
  });
});

// ====== Collab (3) ======

describe('reduceEvent — collab', () => {
  it('collab_started creates session', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'collab_started', id: 'd1', participants: ['a', 'b'], mode: 'sequential' }),
    );
    expect(patch.collabSessions).toHaveLength(1);
    expect(patch.collabSessions![0].id).toBe('d1');
  });

  it('collab_message appends to existing session', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('', { type: 'collab_started', id: 'd1', participants: ['a'], mode: 'seq' })) };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', { type: 'collab_message', id: 'd1', from: 'a', kind: 'utterance', content: 'hi', round: 0 }),
      ),
    };
    expect(s.collabSessions[0].messages).toHaveLength(1);
  });

  it('collab_finished marks session done', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('', { type: 'collab_started', id: 'd1', participants: [], mode: 'seq' })) };
    s = { ...s, ...reduceEvent(s, ev('', { type: 'collab_finished', id: 'd1', outcome: 'consensus', rounds: 3 })) };
    expect(s.collabSessions[0].status).toBe('done');
    expect(s.collabSessions[0].rounds).toBe(3);
  });
});

// ====== MCP (3) ======

describe('reduceEvent — MCP', () => {
  it('mcp_server_started registers server', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'mcp_server_started', server: 'fs', tool_count: 3, transport: 'stdio' }),
    );
    expect(patch.mcpServers![0]).toMatchObject({ name: 'fs', status: 'started' });
  });

  it('mcp_server_failed marks server as failed', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('', { type: 'mcp_server_started', server: 'fs', tool_count: 0, transport: 'stdio' })) };
    s = { ...s, ...reduceEvent(s, ev('', { type: 'mcp_server_failed', server: 'fs', error: 'died', will_retry: false })) };
    expect(s.mcpServers[0].status).toBe('failed');
  });

  it('mcp_tool_invoked appends to invocations', () => {
    const patch = reduceEvent(emptyState(), ev('t1', { type: 'mcp_tool_invoked', server: 'fs', tool: 'read', call_id: 'c1' }));
    expect(patch.mcpInvocations).toHaveLength(1);
    expect(patch.mcpInvocations![0]).toMatchObject({ server: 'fs', tool: 'read' });
  });
});

// ====== LSP (2) ======

describe('reduceEvent — LSP', () => {
  it('lsp_server_started registers', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'lsp_server_started', server: 'rust-analyzer', methods: ['textDocument/hover'], language_ids: ['rust'] }),
    );
    expect(patch.lspServers![0]).toMatchObject({ name: 'rust-analyzer', status: 'started' });
  });

  it('lsp_server_failed marks failed', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'lsp_server_failed', server: 'rust-analyzer', error: 'no binary', will_retry: false }),
    );
    expect(patch.lspServers![0].status).toBe('failed');
  });
});

// ====== Plan mode (5) ======

describe('reduceEvent — plan mode', () => {
  it('plan_request sets pendingPlan', () => {
    const patch = reduceEvent(emptyState(), ev('t1', { type: 'plan_request', plan_id: 'plan-1', task: 'refactor auth' }));
    expect(patch.pendingPlan?.id).toBe('plan-1');
    expect(patch.pendingPlan?.kind).toBe('request');
  });

  it('plan_ready sets pendingPlan with plan_id', () => {
    const patch = reduceEvent(emptyState(), ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '...' }));
    expect(patch.pendingPlan?.id).toBe('p1');
  });

  // v1.x:plan 正文进 Inspector 计划 tab(state.plan),决策后保留并标注。

  it('plan_ready stores plan doc with markdown and path', () => {
    const patch = reduceEvent(emptyState(), ev('t1', {
      type: 'plan_ready', plan_id: 'p1', markdown: '## Plan', path: '/w/.zhuye/plan/p1.md',
    }));
    expect(patch.plan).toEqual({
      planId: 'p1',
      markdown: '## Plan',
      path: '/w/.zhuye/plan/p1.md',
      status: 'ready',
    });
    expect(patch.planDraft).toBeNull();
  });

  it('plan_draft_updated stores draft doc (覆盖式,不再丢弃)', () => {
    const patch = reduceEvent(emptyState(), ev('t1', {
      type: 'plan_draft_updated', draft_id: 'refactor.md', markdown: 'draft v1',
    }));
    expect(patch.planDraft).toEqual({ markdown: 'draft v1', path: null });
  });

  it('plan_request starts a new cycle and clears previous draft', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_draft_updated', draft_id: 'd.md', markdown: 'draft' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_request', plan_id: 'p2', task: 'x' })) };
    expect(s.planDraft).toBeNull();
  });

  it('plan_approved/rejected annotate plan doc but keep markdown', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '## Plan' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_approved', plan_id: 'p1' })) };
    expect(s.plan?.status).toBe('approved');
    expect(s.plan?.markdown).toBe('## Plan');
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_rejected', plan_id: 'p1', reason: 'no' })) };
    expect(s.plan?.status).toBe('rejected');
    expect(s.plan?.markdown).toBe('## Plan');
  });

  it('turn_aborted keeps plan doc and draft (打断后仍可查看)', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '## Plan' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_draft_updated', draft_id: 'd.md', markdown: 'draft' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'turn_aborted', turn_id: 't1', reason: { type: 'user_interrupt' } })) };
    expect(s.plan?.markdown).toBe('## Plan');
    expect(s.planDraft?.markdown).toBe('draft');
  });

  it('plan_approved clears pendingPlan', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_approved', plan_id: 'p1' })) };
    expect(s.pendingPlan).toBeNull();
  });

  it('plan_rejected clears pendingPlan', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '' })) };
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_rejected', plan_id: 'p1', reason: 'no' })) };
    expect(s.pendingPlan).toBeNull();
  });

  it('permission_mode_changed updates to new mode', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'permission_mode_changed', from: 'auto', to: 'plan' }),
    );
    expect(patch.permissionMode).toBe('plan');
  });

  it('permission_mode_changed 归一化弃用档:计划批准的 accept_edits 落 auto', () => {
    // 引擎 apply_plan_approval_choice 的 AutoMode 选择切到弃用的
    // accept_edits(submission_loop.rs),如实回显会出现第四态 —— 桌面
    // 侧归一为 auto(两者在 auto_approves_tool 中行为一致)。
    const patch = reduceEvent(
      emptyState(),
      ev('', { type: 'permission_mode_changed', from: 'plan', to: 'accept_edits' }),
    );
    expect(patch.permissionMode).toBe('auto');
  });
});

// ====== Plugin / quota ======

describe('reduceEvent — plugin / quota', () => {
  it('quota_exhausted 推 toast warn 告知用户配额耗尽', () => {
    const state = emptyState();
    const patch = reduceEvent(
      state,
      ev('', {
        type: 'quota_exhausted',
        provider: 'anthropic',
        label: 'plan-a',
        used_tokens: 50000,
        max_tokens: 50000,
        window_ends_secs: 1800,
      }),
    );
    expect(patch.toasts).toHaveLength(1);
    expect(patch.toasts![0].kind).toBe('warn');
    expect(patch.toasts![0].message).toContain('anthropic/plan-a');
    expect(patch.toasts![0].message).toContain('50000/50000');
    expect(patch.toasts![0].message).toContain('30min');
    expect(patch.toasts![0].ttlMs).toBe(6000);
  });

  it('plan_step 记录执行进度(按 index 就地更新或追加)', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'plan_step',
        plan_id: 'p1',
        index: 0,
        total: 3,
        status: 'in_progress',
        title: 'analyze',
      }),
    );
    expect(patch.planSteps).toEqual([
      { index: 0, total: 3, status: 'in_progress', title: 'analyze', planId: 'p1' },
    ]);
  });

  it('plan_step 同 index 再来一条 → 就地更新,不追加', () => {
    let s: AgentState = { ...emptyState() };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', { type: 'plan_step', plan_id: 'p1', index: 0, total: 2, status: 'in_progress', title: 'a' }),
      ),
    };
    const patch = reduceEvent(
      s,
      ev('', { type: 'plan_step', plan_id: 'p1', index: 0, total: 2, status: 'done', title: 'a' }),
    );
    expect(patch.planSteps).toHaveLength(1);
    expect(patch.planSteps![0].status).toBe('done');
  });

  it('plan_ready 到达时清空上一份执行进度', () => {
    let s: AgentState = { ...emptyState() };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', { type: 'plan_step', plan_id: 'p1', index: 0, total: 1, status: 'done' }),
      ),
    };
    expect(s.planSteps).toHaveLength(1);
    const patch = reduceEvent(
      s,
      ev('', { type: 'plan_ready', plan_id: 'p2', markdown: '## Plan' }),
    );
    expect(patch.planSteps).toEqual([]);
  });

  it('plugin_loaded 记录运行时挂载的插件', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'plugin_loaded',
        plugin: 'demo',
        scope: 'user',
        version: '1.0',
        skill_count: 2,
        command_count: 5,
      }),
    );
    expect(patch.loadedPlugins).toHaveLength(1);
    expect(patch.loadedPlugins![0]).toMatchObject({
      plugin: 'demo',
      scope: 'user',
      version: '1.0',
      skillCount: 2,
      commandCount: 5,
    });
  });

  it('plugin_loaded 同插件再来 → 覆盖而非追加', () => {
    let s: AgentState = { ...emptyState() };
    s = {
      ...s,
      ...reduceEvent(
        s,
        ev('', { type: 'plugin_loaded', plugin: 'demo', scope: 'user', version: '1.0', skill_count: 2 }),
      ),
    };
    const patch = reduceEvent(
      s,
      ev('', { type: 'plugin_loaded', plugin: 'demo', scope: 'project', version: '2.0', skill_count: 3 }),
    );
    expect(patch.loadedPlugins).toHaveLength(1);
    expect(patch.loadedPlugins![0].version).toBe('2.0');
  });

  // ====== 子代理可观测(v1.4 C1)======

  it('subagent_progress 追加进 feed(封顶丢弃最旧)', () => {
    const full = emptyState();
    // 预填到封顶容量,再推一条应只保留最新 SUBAGENT_FEED_CAP 条。
    const capped = {
      ...full,
      subagents: {
        feed: Array.from({ length: 200 }, (_, i) => ({
          id: `old-${i}`,
          childId: 'c-0',
          role: 'explorer',
          kind: 'message' as const,
          text: `m${i}`,
          at: i,
        })),
        lastStatus: null,
      },
    };
    const patch = reduceEvent(
      capped,
      ev('evt-new', {
        type: 'subagent_progress',
        child_id: 'c-1',
        role: 'writer',
        kind: 'tool_begin',
        text: 'Bash',
        call_id: 'call-9',
      }),
    );
    const feed = patch.subagents?.feed ?? [];
    expect(feed).toHaveLength(200);
    expect(feed.at(-1)).toMatchObject({ id: 'evt-new', childId: 'c-1', role: 'writer', kind: 'tool_begin', text: 'Bash' });
    expect(feed[0]).toMatchObject({ id: 'old-1' });
  });

  it('subagent_status 写入 lastStatus 快照', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('evt-s', {
        type: 'subagent_status',
        children: [
          {
            child_id: 'c-2',
            role: 'writer',
            state: 'running',
            started_at: '2026-09-17T00:00:00Z',
            iteration: 4,
            current_tool: 'bash',
            total_tokens: 1234,
            last_event: 'tool begin: bash',
          },
        ],
      }),
    );
    expect(patch.subagents?.lastStatus).toHaveLength(1);
    expect(patch.subagents?.lastStatus?.[0]).toMatchObject({ child_id: 'c-2', state: 'running' });
  });

  it('side_channel 事件不写 agent 状态投影(消费方走 agentEventBus)', () => {
    // 曾有的 lastSnapshot/revision 投影无生产消费方已删;case 仅维护
    // 穷尽性守卫,事件必须安全落到空 patch。
    const patch = reduceEvent(
      emptyState(),
      ev('evt-sc1', {
        type: 'side_channel_status',
        channels: [
          {
            id: 'side-00000001',
            agentName: 'explorer',
            prompt: 'scan the repo',
            startedAtMs: 1,
            status: 'running',
            durationMs: null,
          },
        ],
      }),
    );
    expect(patch).toEqual({});
    expect('sideChannels' in (patch as object)).toBe(false);
  });
});

// ====== 前向兼容(未知事件类型) ======

describe('reduceEvent — 未知事件类型的前向兼容', () => {
  it('运行时未知 msg.type 安全返回空 patch(不抛 TypeError)', () => {
    // 场景:submodule 升级新增 EventMsg 变体、前端类型未同步时,
    // store.subscribe 对 patch 做 Object.keys 展开 —— reducer 返回
    // undefined 会让整条事件处理中断。default 分支必须返回 {}。
    const unknown = { type: 'future_event_kind', payload: { x: 1 } } as unknown as ZhuyeEventMsg;
    const patch = reduceEvent(emptyState(), ev('', unknown));
    expect(patch).toEqual({});
  });

  it('plan_draft_updated 存草稿(v1.x 起渲染进 Inspector 计划 tab;不再 no-op)', () => {
    const patch = reduceEvent(
      emptyState(),
      ev('', {
        type: 'plan_draft_updated',
        draft_id: 'refactor.md',
        markdown: '# 计划\n- 步骤',
        path: '/ws/.zhuye/plan/refactor.md',
      }),
    );
    expect(patch.planDraft).toEqual({ markdown: '# 计划\n- 步骤', path: '/ws/.zhuye/plan/refactor.md' });
  });
});

// ── v1.x:模式切换清悬挂 plan 弹窗(迟到审批不覆盖手动模式) ──────────────

describe('reduceEvent — permission_mode_changed clears pendingPlan', () => {
  it('clears a pending plan modal when the mode is switched away', () => {
    let s: AgentState = emptyState();
    s = { ...s, ...reduceEvent(s, ev('t1', { type: 'plan_request', plan_id: 'p1', task: 'x' })) };
    expect(s.pendingPlan?.id).toBe('p1');
    s = { ...s, ...reduceEvent(s, ev('', { type: 'permission_mode_changed', from: 'plan', to: 'auto' })) };
    expect(s.pendingPlan).toBeNull();
    expect(s.permissionMode).toBe('auto');
  });

  it('keeps state untouched when no plan is pending', () => {
    const patch = reduceEvent(emptyState(), ev('', { type: 'permission_mode_changed', from: 'auto', to: 'plan' }));
    expect(patch).toEqual({ permissionMode: 'plan' });
  });
});
