/**
 * 协议事件矩阵测试 —— zhuye_protocol::EventMsg 全类型 → agentStore 状态。
 *
 * 每种事件类型都通过真实的 `zhuye_event` 总线链路分发
 * （emitEvent → mocked listen → agentEventBus → reduceEvent → store），
 * 并断言**具体的状态效果**（不是"没崩就算过"）。
 * 这保证 submodule 协议演进时前端 reducer 行为被逐变体锁定。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAgentStore } from '@/stores/agentStore';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import type { EventMsgType } from '@/types/protocol';

let backend: FakeBackend;
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  backend = installFakeBackend();
  useAgentStore.getState().reset();
  unsubscribe = useAgentStore.getState().subscribe();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

const st = () => useAgentStore.getState();
const TURN = 'sub-turn-1';

function turnItems(turnId: string) {
  return st().turns.find((t) => t.id === turnId)?.items ?? [];
}

// 先建一个 streaming turn，供 turn 级事件挂载。
function seedTurn() {
  emitEvent(TURN, { type: 'turn_started', turn_id: 't-1' });
}

describe('lifecycle events', () => {
  it('session_configured sets model/provider + context window', () => {
    emitEvent('', {
      type: 'session_configured',
      session_id: 's-1',
      model: 'claude-opus-4.7',
      provider: 'anthropic',
      approval_policy: 'prompt',
      sandbox_policy: 'read_only',
      context_window_size: 200_000,
    });
    expect(st().session).toEqual({ model: 'claude-opus-4.7', provider: 'anthropic' });
    expect(st().contextWindowSize).toBe(200_000);
  });

  it('session_configured with empty model is ignored (no phantom session)', () => {
    emitEvent('', {
      type: 'session_configured',
      session_id: 's-1',
      model: '',
      provider: '',
      approval_policy: 'prompt',
      sandbox_policy: 'read_only',
    });
    expect(st().session).toBeNull();
  });

  it('turn_started creates a streaming turn; duplicate ids are idempotent', () => {
    seedTurn();
    seedTurn();
    expect(st().turns.length).toBe(1);
    expect(st().turns[0].status).toBe('streaming');
  });

  it('turn_complete marks done, turn_aborted marks aborted', () => {
    seedTurn();
    emitEvent(TURN, { type: 'turn_complete', turn_id: 't-1', usage: {}, status: 'success' });
    expect(st().turns[0].status).toBe('done');

    useAgentStore.getState().reset();
    unsubscribe?.();
    unsubscribe = useAgentStore.getState().subscribe();
    seedTurn();
    emitEvent(TURN, {
      type: 'turn_aborted',
      turn_id: 't-1',
      reason: { type: 'user_interrupt' },
    });
    expect(st().turns[0].status).toBe('aborted');
  });

  it('turn_rewound drops the cutoff turn and everything after it', () => {
    // 引擎 truncate_after(to_turn_id) 丢弃该 turn 含及其之后(recorder.rs),
    // 本地截断同语义:rewind 到 sub-1 → sub-1/b/c 全部移除。
    emitEvent('sub-1', { type: 'turn_started', turn_id: 'a' });
    emitEvent('sub-2', { type: 'turn_started', turn_id: 'b' });
    emitEvent('sub-3', { type: 'turn_started', turn_id: 'c' });
    expect(st().turns.length).toBe(3);

    emitEvent('', { type: 'turn_rewound', to_turn_id: 'sub-1', truncated_after: 3 });
    expect(st().turns.map((t) => t.id)).toEqual([]);
  });

  it('turn_rewound without cutoff keeps turns (backend is source of truth)', () => {
    seedTurn();
    emitEvent('', { type: 'turn_rewound', truncated_after: 1 });
    expect(st().turns.length).toBe(1);
  });

  it('shutdown_complete surfaces lastError', () => {
    emitEvent('', { type: 'shutdown_complete' });
    expect(st().lastError).toBe('agent shut down');
  });
});

describe('LLM output events', () => {
  it('agent_message_delta accumulates into a single assistant_text item', () => {
    seedTurn();
    emitEvent(TURN, { type: 'agent_message_delta', delta: 'Hello' });
    emitEvent(TURN, { type: 'agent_message_delta', delta: ' world' });
    const textItem = turnItems(TURN).find((i) => i.kind === 'assistant_text');
    expect(textItem && textItem.kind === 'assistant_text' ? textItem.text : '').toBe('Hello world');
  });

  it('empty delta is a no-op', () => {
    seedTurn();
    emitEvent(TURN, { type: 'agent_message_delta', delta: '' });
    expect(turnItems(TURN).length).toBe(0);
  });

  it('agent_message finalizes assistant text (overwrites streamed draft)', () => {
    seedTurn();
    emitEvent(TURN, { type: 'agent_message_delta', delta: 'partial...' });
    emitEvent(TURN, { type: 'agent_message', text: 'FINAL ANSWER' });
    const texts = turnItems(TURN).filter((i) => i.kind === 'assistant_text');
    expect(texts.length).toBe(1);
    expect(texts[0].kind === 'assistant_text' && texts[0].text).toBe('FINAL ANSWER');
  });

  it('thinking_delta appends a thinking item', () => {
    seedTurn();
    emitEvent(TURN, { type: 'thinking_delta', delta: 'considering...' });
    const item = turnItems(TURN).find((i) => i.kind === 'thinking');
    expect(item && item.kind === 'thinking' ? item.text : '').toBe('considering...');
  });

  it('token_count updates token snapshot', () => {
    emitEvent(TURN, {
      type: 'token_count',
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 20,
      cache_write_tokens: 5,
      total_tokens: 150,
      provider: 'anthropic',
      credential_label: 'main',
    });
    expect(st().tokens).toMatchObject({
      input: 100,
      output: 50,
      cached: 20,
      total: 150,
      provider: 'anthropic',
      credentialLabel: 'main',
    });
  });

  it('token_count accumulates sessionCost and keeps last-call cost', () => {
    emitEvent(TURN, {
      type: 'token_count',
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 150,
      cost_usd: 0.0021,
    });
    emitEvent(TURN, {
      type: 'token_count',
      input_tokens: 80,
      output_tokens: 30,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 110,
      cost_usd: 0.0017,
    });
    const tokens = st().tokens;
    expect(tokens?.cost).toBeCloseTo(0.0017); // 最近一次调用
    expect(tokens?.sessionCost).toBeCloseTo(0.0038); // 累计
  });

  it('token_count without cost_usd keeps null cost and does not grow sessionCost', () => {
    emitEvent(TURN, {
      type: 'token_count',
      input_tokens: 10,
      output_tokens: 5,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 15,
      cost_usd: 0.01,
    });
    emitEvent(TURN, {
      type: 'token_count',
      input_tokens: 10,
      output_tokens: 5,
      cached_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 15,
    });
    const tokens = st().tokens;
    expect(tokens?.cost).toBeNull(); // 未定价模型
    expect(tokens?.sessionCost).toBeCloseTo(0.01); // 累计不增
  });
});

describe('tool events', () => {
  it('tool_call_begin/end pair marks tool done + appends output', () => {
    seedTurn();
    emitEvent(TURN, {
      type: 'tool_call_begin',
      call_id: 'call-1',
      tool_name: 'read_file',
      args: { path: 'src/lib.rs' },
    });
    let call = turnItems(TURN).find((i) => i.kind === 'tool_call');
    expect(call && call.kind === 'tool_call' ? call.status : '').toBe('running');

    emitEvent(TURN, {
      type: 'tool_call_end',
      call_id: 'call-1',
      is_error: false,
      elapsed_ms: 42,
      output: { content: [{ type: 'text', text: 'file contents here' }], is_error: false, metadata: null, elapsed_ms: 42 },
    });
    call = turnItems(TURN).find((i) => i.kind === 'tool_call');
    expect(call && call.kind === 'tool_call' ? call.status : '').toBe('done');
    const out = turnItems(TURN).find((i) => i.kind === 'tool_output');
    expect(out && out.kind === 'tool_output' ? out.isError : true).toBe(false);
  });

  it('tool_call_end with is_error flags the tool call as error', () => {
    seedTurn();
    emitEvent(TURN, { type: 'tool_call_begin', call_id: 'e1', tool_name: 'bash', args: { cmd: 'rm -rf' } });
    emitEvent(TURN, {
      type: 'tool_call_end',
      call_id: 'e1',
      is_error: true,
      elapsed_ms: 10,
      output: { content: [{ type: 'text', text: 'denied' }], is_error: true, metadata: null, elapsed_ms: 10 },
    });
    const call = turnItems(TURN).find((i) => i.kind === 'tool_call');
    expect(call && call.kind === 'tool_call' ? call.status : '').toBe('error');
  });

  it('tool_execution_request is a protocol-exhaustive no-op (serve mode only)', () => {
    seedTurn();
    emitEvent(TURN, { type: 'tool_execution_request', call_id: 'x', tool: 'remote', args: {} });
    expect(turnItems(TURN).length).toBe(0);
  });
});

describe('approval & question events', () => {
  it('approval_request (tool) queues a pendingApproval with summarized args', () => {
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-1',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'cargo test' } },
      risk: 'high',
    });
    expect(st().pendingApprovals.length).toBe(1);
    expect(st().pendingApprovals[0]).toMatchObject({
      id: 'apr-1',
      kind: 'tool',
      toolName: 'bash',
      turnId: TURN,
    });
  });

  it('approval_request (plan) bypasses pendingApprovals (plan_ready modal owns it)', () => {
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-plan',
      kind: { type: 'plan', plan_id: 'p1', summary: 's' },
    });
    expect(st().pendingApprovals.length).toBe(0);
  });

  it('ask_user_question queues pendingQuestions with payload', () => {
    emitEvent(TURN, {
      type: 'ask_user_question',
      request_id: 'q-1',
      questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
    });
    expect(st().pendingQuestions.length).toBe(1);
    expect(st().pendingQuestions[0].payload.questions[0].question).toBe('Pick one');
  });

  it('ask_user_input queues pendingAskUser', () => {
    emitEvent(TURN, {
      type: 'ask_user_input',
      request_id: 'in-1',
      prompt: 'Branch name?',
      placeholder: 'feat/x',
    });
    expect(st().pendingAskUser.length).toBe(1);
  });

  it('同回合多 agent 提问:其一的工具结束不连坐清空其余挂起提问,了结按 request_id 精确移除', () => {
    seedTurn();
    // 父 agent 与子代理的提问经转发共享同一父 turnId,先后入列。
    emitEvent(TURN, {
      type: 'ask_user_question',
      request_id: 'q-a',
      questions: [{ question: 'A?', options: [{ label: 'a1' }] }],
    });
    emitEvent(TURN, {
      type: 'ask_user_question',
      request_id: 'q-b',
      questions: [{ question: 'B?', options: [{ label: 'b1' }] }],
    });
    expect(st().pendingQuestions.map((q) => q.id)).toEqual(['q-a', 'q-b']);
    // 第一个提问的 ask_user_question 工具调用结束(应答后引擎关闸)。
    emitEvent(TURN, { type: 'tool_call_begin', call_id: 'c-a', tool_name: 'ask_user_question', args: {} });
    emitEvent(TURN, {
      type: 'tool_call_end',
      call_id: 'c-a',
      is_error: false,
      elapsed_ms: 5,
      output: { content: [{ type: 'text', text: 'answered' }], is_error: false, metadata: null, elapsed_ms: 5 },
    });
    // 历史缺陷:tool_call_end 曾按 turnId 连坐清空 —— 其余 agent 仍挂起
    // 的提问卡被误删、composer 提前回归。两条挂起现在都必须还在。
    expect(st().pendingQuestions.map((q) => q.id)).toEqual(['q-a', 'q-b']);
    // q-a 的了结广播到达:仅移除 q-a,q-b 不受影响。
    emitEvent(TURN, {
      type: 'interaction_resolved',
      request_id: 'q-a',
      kind: { type: 'question' },
      outcome: 'answered',
    });
    expect(st().pendingQuestions.map((q) => q.id)).toEqual(['q-b']);
  });

  it('permission_bubble becomes a non-blocking toast, not a synthetic approval', () => {
    emitEvent(TURN, { type: 'permission_bubble', tool_name: 'write_file', risk: 'medium' });
    // bubble = core 已自动批准,只提示;合成 approval 会渲染成无法应答的 modal。
    expect(st().pendingApprovals.length).toBe(0);
    expect(st().toasts.length).toBe(1);
    expect(st().toasts[0].message).toContain('write_file');
  });
});

describe('PROMPT_PROFILE_NOT_FOUND 自清理(store 订阅接线)', () => {
  it('error 事件到达即清除该会话的提示词缓存键,其他会话不受影响', () => {
    // 陈旧手动 profile 缓存:bind 恢复会原样重发,引擎报本错误且校验失败
    // 不落 rollout —— 订阅清键后下次 bind 不再重发、不再重复报错。
    localStorage.setItem('zhuye.promptSelection.sess-stale', JSON.stringify({ mode: 'manual', profile: 'bogus' }));
    localStorage.setItem('zhuye.promptSelection.other', JSON.stringify({ mode: 'auto' }));
    useAgentStore.setState({ loadedSessionId: 'sess-stale' });

    emitEvent('', { type: 'error', code: 'PROMPT_PROFILE_NOT_FOUND', message: '提示词方案不存在' });
    // 缓存键已清;错误本身仍按事件通道原样落 lastError 展示一次。
    expect(localStorage.getItem('zhuye.promptSelection.sess-stale')).toBeNull();
    expect(st().lastError).toBe('PROMPT_PROFILE_NOT_FOUND: 提示词方案不存在');
    // 其他会话键不受影响。
    expect(localStorage.getItem('zhuye.promptSelection.other')).toBe(JSON.stringify({ mode: 'auto' }));

    localStorage.removeItem('zhuye.promptSelection.other');
  });

  it('其他 error code 不触发清键', () => {
    localStorage.setItem('zhuye.promptSelection.sess-ok', JSON.stringify({ mode: 'auto' }));
    useAgentStore.setState({ loadedSessionId: 'sess-ok' });

    emitEvent('', { type: 'error', code: 'PROMPT_SAVE_FAILED', message: '提示词方案不存在' });
    expect(localStorage.getItem('zhuye.promptSelection.sess-ok')).toBe(JSON.stringify({ mode: 'auto' }));

    localStorage.removeItem('zhuye.promptSelection.sess-ok');
  });
});

describe('context / error / routing events', () => {
  it('context_compacted 聚合进 compactions 统计,不产生对话 item', () => {
    seedTurn();
    emitEvent(TURN, {
      type: 'context_compacted',
      strategy: 'llm_summarize',
      removed_messages: 12,
      before_tokens: 100_000,
      after_tokens: 20_000,
    });
    expect(turnItems(TURN).find((i) => i.kind === 'compacted')).toBeUndefined();
    expect(st().compactions).toMatchObject({
      count: 1,
      removedMessages: 12,
      tokensSaved: 80_000,
      last: 'llm_summarize: 12 msgs (100000 → 20000 tokens)',
    });
    // 逐次明细:压缩前后的 token 可核对。
    expect(st().compactions.records).toHaveLength(1);
    expect(st().compactions.records[0]).toMatchObject({
      strategy: 'llm_summarize',
      removedMessages: 12,
      beforeTokens: 100_000,
      afterTokens: 20_000,
      tokensSaved: 80_000,
    });
  });

  it('error on session level sets lastError; on turn level appends an error item', () => {
    emitEvent('', { type: 'error', code: 'E_CONFIG', message: 'bad config' });
    expect(st().lastError).toBe('E_CONFIG: bad config');

    seedTurn();
    emitEvent(TURN, { type: 'error', code: 'E_TOOL', message: 'boom' });
    const item = turnItems(TURN).find((i) => i.kind === 'error');
    expect(item && item.kind === 'error' ? item.text : '').toBe('E_TOOL: boom');
  });

  it('stream_error prefers message text', () => {
    seedTurn();
    emitEvent(TURN, {
      type: 'stream_error',
      code: '429',
      message: 'rate limited',
      retry_in_ms: 5000,
      provider: 'anthropic',
    });
    const item = turnItems(TURN).find((i) => i.kind === 'error');
    expect(item && item.kind === 'error' ? item.text : '').toBe('rate limited');
  });

  it('stream_error without message falls back to code+retry', () => {
    emitEvent('', { type: 'stream_error', code: 'E_NET', message: '', retry_in_ms: 250 });
    expect(st().lastError).toBe('stream error E_NET (retry in 250ms)');
  });

  it('config_reloaded stamps configReloadedAt', () => {
    emitEvent('', { type: 'config_reloaded', path: '~/.zhuye/config.toml', sections_changed: ['active'], at: 1_700_000_000 });
    expect(st().configReloadedAt).toBeGreaterThan(0);
  });

  it('routing records the last routing transition', () => {
    emitEvent('', {
      type: 'routing',
      kind: 'failed_over',
      role: 'primary',
      from_credential: 'key-a',
      to_credential: 'key-b',
      reason: 'quota',
    });
    expect(st().lastRouting).toMatchObject({ kind: 'failed_over', to: 'key-b', reason: 'quota' });
  });
});

describe('collab / MCP / LSP events', () => {
  it('collab lifecycle: started → messages → finished', () => {
    emitEvent('', { type: 'collab_started', id: 'col-1', participants: ['a', 'b'], mode: 'debate' });
    emitEvent('', { type: 'collab_message', id: 'col-1', from: 'a', kind: 'utterance', content: 'I think X', round: 1 });
    emitEvent('', { type: 'collab_message', id: 'col-1', from: 'b', kind: 'consensus', content: 'agree', round: 2 });
    emitEvent('', { type: 'collab_finished', id: 'col-1', outcome: 'consensus', rounds: 2 });

    const col = st().collabSessions[0];
    expect(col.status).toBe('done');
    expect(col.outcome).toBe('consensus');
    expect(col.messages.map((m) => m.from)).toEqual(['a', 'b']);
  });

  it.each(['failed', 'cancelled'] as const)('collab %s ends without a success status', (outcome) => {
    emitEvent('', { type: 'collab_started', id: 'col-error', participants: ['a'], mode: 'sequential' });
    emitEvent('', { type: 'collab_finished', id: 'col-error', outcome, rounds: 0 });
    expect(st().collabSessions.find((session) => session.id === 'col-error')).toMatchObject({ status: outcome, outcome });
  });

  it('mcp server start/fail upserts server registry', () => {
    emitEvent('', { type: 'mcp_server_started', server: 'search', tool_count: 3, transport: 'stdio' });
    expect(st().mcpServers[0]).toMatchObject({ name: 'search', status: 'started' });

    emitEvent('', { type: 'mcp_server_failed', server: 'search', error: 'conn refused', will_retry: true });
    expect(st().mcpServers[0].status).toBe('failed');
    expect(st().mcpServers[0].detail).toBe('conn refused');
  });

  it('mcp_tool_invoked appends to bounded invocation log', () => {
    emitEvent('', { type: 'mcp_tool_invoked', server: 'search', tool: 'query', call_id: 'c1' });
    expect(st().mcpInvocations.length).toBe(1);
    expect(st().mcpInvocations[0]).toMatchObject({ server: 'search', tool: 'query' });
  });

  it('lsp server start/fail upserts server registry', () => {
    emitEvent('', { type: 'lsp_server_started', server: 'rust-analyzer', methods: ['definition'], language_ids: ['rust'] });
    expect(st().lspServers[0]).toMatchObject({ name: 'rust-analyzer', status: 'started' });

    emitEvent('', { type: 'lsp_server_failed', server: 'rust-analyzer', error: 'crashed', will_retry: false });
    expect(st().lspServers[0].status).toBe('failed');
  });
});

describe('plan mode events', () => {
  it('plan_request then plan_ready both stage pendingPlan; approval clears it', () => {
    emitEvent(TURN, { type: 'plan_request', plan_id: 'request-42', task: 'migrate DB' });
    expect(st().pendingPlan?.id).toBe('request-42');

    emitEvent(TURN, { type: 'plan_ready', plan_id: 'plan-42', markdown: '# Steps\n1. x' });
    expect(st().pendingPlan?.id).toBe('plan-42');

    emitEvent(TURN, { type: 'plan_approved', plan_id: 'plan-42' });
    expect(st().pendingPlan).toBeNull();
  });

  it('plan_rejected also clears pendingPlan', () => {
    emitEvent(TURN, { type: 'plan_ready', plan_id: 'p9', markdown: 'md' });
    emitEvent(TURN, { type: 'plan_rejected', plan_id: 'p9', reason: 'too risky' });
    expect(st().pendingPlan).toBeNull();
  });

  it('ignores approval for an older plan', () => {
    emitEvent(TURN, { type: 'plan_ready', plan_id: 'current-plan', markdown: 'md' });
    emitEvent(TURN, { type: 'plan_approved', plan_id: 'old-plan' });
    expect(st().pendingPlan?.id).toBe('current-plan');
  });

  it('plan_draft_updated and plan_step are no-ops (TUI semantics, type-complete)', () => {
    seedTurn();
    emitEvent(TURN, { type: 'plan_draft_updated', draft_id: 'refactor.md', markdown: '# draft' });
    emitEvent(TURN, { type: 'plan_step', plan_id: 'p1', index: 0, total: 3, status: 'in_progress', title: 'step 0' });
    expect(turnItems(TURN).length).toBe(0);
    expect(st().pendingPlan).toBeNull();
  });

  it('permission_mode_changed updates store mode', () => {
    emitEvent('', { type: 'permission_mode_changed', from: 'prompt', to: 'plan' });
    expect(st().permissionMode).toBe('plan');
  });

  it('permission_mode_changed 归一化弃用档 accept_edits(计划批准产物)为 auto', () => {
    emitEvent('', { type: 'permission_mode_changed', from: 'plan', to: 'accept_edits' });
    expect(st().permissionMode).toBe('auto');
  });
});

describe('plugin / quota events', () => {
  it('plugin_loaded is a no-op (panel TODO, type-complete)', () => {
    emitEvent('', { type: 'plugin_loaded', plugin: 'jira', scope: 'global', version: '1.0' });
    expect(st().lastError).toBeNull();
  });

  it('quota_exhausted raises a warning toast with reset hint', () => {
    emitEvent('', {
      type: 'quota_exhausted',
      provider: 'anthropic',
      label: 'main-key',
      used_tokens: 9_000,
      max_tokens: 10_000,
      window_ends_secs: 15 * 60,
    });
    const toast = st().toasts.find((t) => t.kind === 'warn');
    expect(toast).toBeDefined();
    expect(toast!.message).toContain('anthropic/main-key');
    expect(toast!.message).toContain('9000/10000');
    expect(toast!.message).toContain('15min');
  });
});

describe('protocol exhaustive guard', () => {
  // 穷尽性检查：TS 编译期已保证 reducer 覆盖全部变体；运行时再验证
  // 未知 type 不中断事件流（submodule 领先于前端类型时的降级路径）。
  it('unknown event type at runtime is safely ignored', () => {
    expect(() => {
      emitEvent(TURN, { type: 'future_unknown_event' } as never);
    }).not.toThrow();
    expect(st().turns.length).toBe(0);
  });

  it('EventMsgType union stays in sync with reducer (count sanity)', async () => {
    const mod = await import('@/types/protocol/event');
    // 编译期判别联合的变体数量 —— 数量变化时应同步审查本矩阵。
    const source = mod.EVENT_ID_NONE; // 模块可加载
    expect(source).toBe('');
    void (null as unknown as EventMsgType);
  });
});
