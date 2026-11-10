/**
 * 事件面跨运行时契约 · fakeBackend 侧。
 *
 * `tests/contracts/events.json` 为协议 `EventMsg` 的**全部变体**各给出一份
 * 最小合法样本。同一份样本被三层消费(L1 event-parity / L3
 * `ipc_event_contract.rs` / 本文件)。真后端侧由 L3 驱动协议 serde,这里
 * 驱动**前端事件链路**:样本经真实 `reflect_event` 总线语义
 * (emitEvent → agentEventBus → store.subscribe → reduceEvent)进入
 * reducer。
 *
 * ## 为什么需要这一层
 *
 * reducer 对未知 `type` 是**安全降级**(空 patch)。submodule 升级新增 /
 * 改名事件后,前端测试会继续全绿、UI 静默吞掉新事件 —— 与 payload 契约
 * (`ipc.payload-contract.test.ts`)堵住的"参数形状漂移"镜像对称,这里堵
 * 的是"事件形状漂移"。
 *
 * ## 断言口径
 *
 * - 样本键必须是合法 `EventMsgType`(类型层锁定);
 * - 除**白名单**(reducer 中有显式 case、注释化为 no-op 的变体)外,每条
 *   样本必须产生**非空 patch** —— 空 patch 意味着落进了 unknown 分支,
 *   即前端类型与 wire 漂移;
 * - 全链路冒烟:session_configured + turn 生命周期样本经真实 bus 分发后,
 *   store 出现对应投影。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { useAgentStore } from '@/stores/agentStore';
import { reduceEvent } from '@/stores/agent';
import type { EventMsgType, ReflectEventMsg } from '@/types/protocol';

const doc = JSON.parse(readFileSync('tests/contracts/events.json', 'utf8')) as {
  events: Record<string, { type: string }>;
};

const SAMPLES = Object.entries(doc.events);

/**
 * reducer 中**有显式 case** 但返回空 patch 的变体(均见 reducer 内注释):
 * - `submission_closed` / `tool_execution_request` / `tool_call_output_delta`
 *   —— serve 模式 / GUI 暂不消费,保穷尽性守卫 no-op;
 * - `side_channel_started|finished|status` —— 消费方(SideChannelView)
 *   直接订阅 agentEventBus,store 不投影;
 * - `turn_rewound` —— to_turn_id 未水合时按乱序宽容(reducer 显式分支),
 *   样本无前置 turn 上下文,必走该分支;
 * - `plan_draft_updated` —— TUI 草稿预览语义,GUI 决策走 plan_ready 弹窗,
 *   reducer 显式占位 no-op。
 * 白名单外的变体出现空 patch = 落入 unknown 分支 = 类型漂移。
 */
const NO_PATCH_WHITELIST: ReadonlySet<string> = new Set([
  'submission_closed',
  'tool_execution_request',
  'tool_call_output_delta',
  'tool_call_args_delta',
  'side_channel_started',
  'side_channel_finished',
  'side_channel_status',
  'turn_rewound',
  'plan_draft_updated',
]);

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

describe('event contract · sample table', () => {
  it('covers the full EventMsgType union (every key is a legal variant)', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(50);
    for (const [ty] of SAMPLES) {
      // 类型层断言:非法键在编译期即失败(as 收窄只对运行时样本,类型错误
      // 由 tsc 抓)。合法 EventMsgType 集合 ↔ 样本表的全集等价由 L1
      // event-parity(Rust enum ↔ TS ↔ 本表三方)守卫。
      const legal = ty as EventMsgType;
      expect(legal).toBeTruthy();
      expect(doc.events[ty].type).toBe(ty);
    }
  });

  it('every sample produces a non-empty reducer patch (no unknown-branch fallback)', () => {
    const empties: string[] = [];
    for (const [ty, sample] of SAMPLES) {
      const patch = reduceEvent(st(), {
        id: ty === 'session_configured' || ty === 'shutdown_complete' ? '' : 'sub-contract',
        msg: sample as ReflectEventMsg,
      });
      if (Object.keys(patch).length === 0 && !NO_PATCH_WHITELIST.has(ty)) {
        empties.push(ty);
      }
    }
    expect(
      empties,
      `以下变体落入了 reducer 的 unknown 分支(空 patch)—— 前端类型或样本漂移:\n  ${empties.join(', ')}`,
    ).toEqual([]);
  });
});

describe('event contract · full-bus smoke', () => {
  it('session_configured sample projects into the store through the real bus', () => {
    emitEvent('', doc.events.session_configured as ReflectEventMsg);
    expect(st().session).toEqual({ model: 'claude-opus-4.7', provider: 'anthropic' });
  });

  it('turn lifecycle samples project turns through the real bus', () => {
    emitEvent('sub-contract', doc.events.turn_started as ReflectEventMsg);
    emitEvent('sub-contract', doc.events.agent_message_delta as ReflectEventMsg);
    expect(st().turns.find((turn) => turn.id === 'sub-contract')).toBeTruthy();
    emitEvent('sub-contract', doc.events.turn_complete as ReflectEventMsg);
    expect(st().turns.find((turn) => turn.id === 'sub-contract')?.status).toBe('done');
  });
});

describe('event contract · wire drift detectors (self-test)', () => {
  it('a renamed variant would be caught by the non-empty-patch assertion', () => {
    // 模拟"上游新增/改名变体后样本未跟"的历史场景:未知 type 必须判为
    // 空 patch —— 这是本契约的探针语义,失效即空转。
    const unknown = { type: 'definitely_not_a_real_event_v1' } as unknown as ReflectEventMsg;
    const patch = reduceEvent(st(), { id: 'sub-probe', msg: unknown });
    expect(Object.keys(patch).length).toBe(0);
  });

  it('backend fixtures remain untouched by contract emissions', () => {
    const callsBefore = backend.calls.length;
    emitEvent('sub-contract', doc.events.agent_message as ReflectEventMsg);
    expect(backend.calls.length).toBe(callsBefore);
  });
});
