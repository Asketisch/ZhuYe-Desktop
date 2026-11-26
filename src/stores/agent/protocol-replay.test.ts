/**
 * src/stores/agent/protocol-replay.test.ts —— 协议回放与属性测试(验证增强计划 P2)。
 *
 * 三个不变量:
 *  1. **契约回放**:核心仓 `zhuye-agent/tests/contracts/events.json` 的全部
 *     EventMsg 变体样本(随 submodule 只读引入)逐一喂给 `reduceEvent`,
 *     不得抛错、不得产生损坏状态 —— submodule 升级引入新变体时,本测试
 *     自动覆盖到新样本;
 *  2. **合法新增变体容忍**:Protocol v0 允许加变体 —— 运行时未知 msg.type
 *     返回空 patch(reducer.ts default 分支),且不破坏已知状态的后续处理;
 *  3. **属性(fast-check)**:
 *     - 流式等价:N 个 `agent_message_delta` 分片与「整段 agent_message」
 *       产生相同的助手文本(批处理边界不影响最终状态);
 *     - 回放幂等:完整回合序列(以 agent_message 收尾)重放一遍,
 *       turns 数量与文本不变(会话水合不重复)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { reduceEvent } from './reducer';
import type { AgentState } from './types';
import type { ZhuyeEvent, ZhuyeEventMsg } from '@/types/protocol';

// ====== 夹具:核心仓协议契约样本(submodule 只读) ======

interface ContractFixture {
  comment: string;
  events: Record<string, Record<string, unknown>>;
}

const CONTRACT_PATH = resolve(process.cwd(), 'zhuye-agent/tests/contracts/events.json');
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8')) as ContractFixture;
const contractVariants = Object.keys(contract.events);

// ====== Helpers(与 agentStore.test.ts 同构的最小 AgentState 工厂) ======

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
  reorderQueued: () => {},
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

const ev = (id: string, msg: unknown): ZhuyeEvent =>
  ({ id, msg: msg as ZhuyeEventMsg, seq: 0 });

/** 顺序应用事件流;每步把 reducer 的 patch 合并进状态(与 store.subscribe 同语义)。 */
function applyAll(state: AgentState, events: ZhuyeEvent[]): AgentState {
  const current = { ...state };
  for (const event of events) {
    Object.assign(current, reduceEvent(current, event));
  }
  return current;
}

/** 提取某回合的助手文本(全部 assistant_text item 拼接)。 */
function assistantText(state: AgentState, turnId: string): string {
  const turn = state.turns.find((item) => item.id === turnId);
  return (turn?.items ?? [])
    .filter((item) => item.kind === 'assistant_text')
    .map((item) => item.text)
    .join('');
}

// ====== 1. 契约回放 ======

describe('契约回放(核心仓 events.json)', () => {
  it('样本齐全:契约至少覆盖 50 个变体(防夹具退化)', () => {
    expect(contractVariants.length).toBeGreaterThanOrEqual(50);
  });

  it('全部变体样本可被 reducer 消费:不抛错、patch 为对象', () => {
    for (const variant of contractVariants) {
      const sample = contract.events[variant];
      // 全局事件(id="")与回合内事件(随机 id)两条路径都要能消费。
      expect(() => reduceEvent(emptyState(), ev('', sample))).not.toThrow();
      const patch = reduceEvent(emptyState(), ev('turn-sample', sample));
      expect(patch).toBeTypeOf('object');
    }
  });

  it('样本序列回放后状态结构完整(turns 为数组、item 文本为字符串)', () => {
    let state = emptyState();
    contractVariants.forEach((variant, index) => {
      const id = variant.startsWith('session_') || variant.includes('shutdown')
        ? '' : `turn-${index}`;
      Object.assign(state, reduceEvent(state, ev(id, contract.events[variant])));
    });
    expect(Array.isArray(state.turns)).toBe(true);
    for (const turn of state.turns) {
      expect(typeof turn.id).toBe('string');
      for (const item of turn.items) {
        if (item.kind === 'assistant_text') {
          expect(typeof item.text).toBe('string');
        }
      }
    }
  });
});

// ====== 2. 合法新增变体容忍(Protocol v0) ======

describe('合法新增变体容忍', () => {
  // 模拟 submodule 未来新增而前端类型尚未同步的事件(运行时形态)。
  const futureEvent = {
    type: 'zhuye_future_variant_v99',
    payload: { arbitrary: true, nested: { list: [1, 'x'] } },
  };

  it('未知 msg.type 返回空 patch,不抛错', () => {
    const patch = reduceEvent(emptyState(), ev('', futureEvent));
    expect(patch).toEqual({});
  });

  it('未知事件夹在正常流中间,不吞掉后续已知事件', () => {
    const state = applyAll(emptyState(), [
      ev('t1', { type: 'turn_started', turn_id: 't1' }),
      ev('t1', futureEvent),
      ev('t1', { type: 'agent_message', text: '未知事件之后仍正常' }),
    ]);
    expect(assistantText(state, 't1')).toBe('未知事件之后仍正常');
    expect(state.turns).toHaveLength(1);
  });
});

// ====== 3. 属性测试(fast-check) ======

describe('属性:流式等价与回放幂等', () => {
  // 任意非空文本分片(含 Unicode);reducer 对空 delta 返回空 patch,等价于跳过。
  const pieceArb = fc.string({ minLength: 1, maxLength: 40 });

  it('N 个 delta 分片 ≡ 整段 agent_message(批处理边界不影响最终文本)', () => {
    fc.assert(
      fc.property(fc.array(pieceArb, { maxLength: 24 }), (pieces) => {
        const joined = pieces.join('');
        const streamState = applyAll(emptyState(), [
          ev('t1', { type: 'turn_started', turn_id: 't1' }),
          ...pieces.map((delta) => ev('t1', { type: 'agent_message_delta', delta })),
        ]);
        const wholeState = applyAll(emptyState(), [
          ev('t1', { type: 'turn_started', turn_id: 't1' }),
          ev('t1', { type: 'agent_message', text: joined }),
        ]);
        expect(assistantText(streamState, 't1')).toBe(joined);
        expect(assistantText(wholeState, 't1')).toBe(joined);
      }),
      { numRuns: 300 },
    );
  });

  it('完整回合序列(以 agent_message 收尾)重放不重复、不变形', () => {
    fc.assert(
      fc.property(fc.array(pieceArb, { maxLength: 24 }), (pieces) => {
        const events: ZhuyeEvent[] = [
          ev('t1', { type: 'turn_started', turn_id: 't1' }),
          ...pieces.map((delta) => ev('t1', { type: 'agent_message_delta', delta })),
          ev('t1', { type: 'agent_message', text: pieces.join('') }),
          ev('t1', { type: 'turn_complete', status: 'success' }),
        ];
        const first = applyAll(emptyState(), events);
        const replayed = applyAll(first, events);
        // 会话水合语义:重放后回合数不变(turn_started 去重)、文本不变
        // (agent_message 为替换语义,重放的 delta 追加被最终 finalize 覆盖)。
        expect(replayed.turns).toHaveLength(first.turns.length);
        expect(assistantText(replayed, 't1')).toBe(assistantText(first, 't1'));
        expect(replayed.turns[0]?.status).toBe('done');
      }),
      { numRuns: 300 },
    );
  });
});

// ====== v1.10:agent_message_reset 与中断兜底语义 ======

describe('v1.10 流式重试与中断兜底', () => {
  it('agent_message_reset clears the in-flight assistant text before retry', () => {
    const state = applyAll(emptyState(), [
      ev('t1', { type: 'turn_started', turn_id: 't1' }),
      ev('t1', { type: 'agent_message_delta', delta: '半截回答' }),
      ev('t1', {
        type: 'agent_message_reset',
        reason_code: 'SSE_PARSE_ERROR',
        retry_in_ms: 500,
      }),
      ev('t1', { type: 'agent_message_delta', delta: '完整回答' }),
    ]);
    expect(assistantText(state, 't1')).toBe('完整回答');
  });

  it('agent_message_reset keeps completed steps and drops a running tool call', () => {
    const state = applyAll(emptyState(), [
      ev('t1', { type: 'turn_started', turn_id: 't1' }),
      ev('t1', {
        type: 'tool_call_begin',
        call_id: 'c0',
        tool_name: 'bash',
        args: { cmd: 'ls' },
      }),
      ev('t1', {
        type: 'tool_call_end',
        call_id: 'c0',
        tool_name: 'bash',
        output: { content: [{ type: 'text', text: 'a.rs' }], is_error: false },
        is_error: false,
      }),
      ev('t1', {
        type: 'tool_call_begin',
        call_id: 'c1',
        tool_name: 'write',
        args: null,
      }),
      ev('t1', { type: 'agent_message_reset', reason_code: 'SSE_PARSE_ERROR', retry_in_ms: 0 }),
    ]);
    const items = state.turns[0].items;
    // 已完成的工具调用链保留;半成品的 running 工具调用被清掉。
    expect(items.some((item) => item.kind === 'tool_call' && item.callId === 'c0')).toBe(true);
    expect(items.some((item) => item.kind === 'tool_call' && item.callId === 'c1')).toBe(false);
  });

  it('turn_aborted with an unmatched id still releases the streaming turn', () => {
    // 引擎空闲期中断回执的 turn_id 是现编的;前端必须兜底解卡,
    // 否则失败/结束后点停止「没有反应」。
    const state = applyAll(emptyState(), [
      ev('t1', { type: 'turn_started', turn_id: 't1' }),
      ev('some-other-id', {
        type: 'turn_aborted',
        turn_id: 'freshly-minted',
        reason: { type: 'user_interrupt' },
      }),
    ]);
    expect(state.turns[0].status).toBe('aborted');
  });

  it('engine turn_aborted(Error) terminal ends the failed turn (no stuck streaming)', () => {
    const state = applyAll(emptyState(), [
      ev('t1', { type: 'turn_started', turn_id: 't1' }),
      ev('t1', { type: 'error', code: 'SSE_PARSE_ERROR', message: 'boom' }),
      ev('t1', {
        type: 'turn_aborted',
        turn_id: 't1',
        reason: { type: 'error', code: 'SSE_PARSE_ERROR', message: 'boom' },
      }),
    ]);
    expect(state.turns[0].status).toBe('aborted');
  });
});
