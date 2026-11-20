/**
 * src/stores/backgroundSessions.test.ts —— 后台会话注册表(v1.x 后台持续运行)。
 *
 * 锁定三个契约:
 * 1. ingest 复用主 reducer:后台事件驱动 running / pending 投影,形状与
 *    主 store 的 pending* 字段一致(审批/提问/plan 不漂移);
 * 2. demote 把前台在飞投影(turns + 待确认交互)播种进后台 scratch,
 *    mergePendingInto 在切回时把它们整体注回主 store —— gate 请求不落
 *    rollout、在飞回合的 assistant 消息也要等回合结束才落盘,两者都只能
 *    靠内存投影跨会话切换存活;
 * 3. demote 播种切走时的运行态(turn_started 是前台事件,降级后的
 *    后台通道不会重发),后续 turn 收尾事件把它拉回 false。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetBackgroundScratchesForTests, useBackgroundSessions } from './backgroundSessions';
import { useAgentStore } from './agentStore';
import type { ZhuyeEvent } from '@/types/protocol';

function ev(id: string, msg: Record<string, unknown>): ZhuyeEvent {
  return { id, msg } as unknown as ZhuyeEvent;
}

const SESSION_A = 'sess-bg-a';
const SESSION_B = 'sess-bg-b';

/** 构造一份「前台在飞」的投影(在飞 turn + 已产出的助手输出)。 */
function foregroundProjection() {
  return {
    turns: [
      {
        id: 't-live',
        items: [
          { kind: 'user_text' as const, text: '跑起来' },
          { kind: 'assistant_text' as const, text: '正在做' },
        ],
        status: 'streaming' as const,
      },
    ],
    pendingApprovals: [],
    pendingQuestions: [],
    pendingAskUser: [],
    pendingPlan: null,
  };
}

beforeEach(() => {
  __resetBackgroundScratchesForTests();
  useBackgroundSessions.setState({ sessions: {} });
  useAgentStore.getState().reset();
});

describe('backgroundSessions — ingest 复用主 reducer', () => {
  it('turn_started → running=true;turn_complete → running=false', () => {
    const { ingest } = useBackgroundSessions.getState();
    ingest(SESSION_A, ev('t1', { type: 'turn_started' }));
    expect(useBackgroundSessions.getState().sessions[SESSION_A]).toMatchObject({
      running: true,
      pendingCount: 0,
    });
    ingest(SESSION_A, ev('t1', { type: 'turn_complete', usage: {}, status: 'done' }));
    expect(useBackgroundSessions.getState().sessions[SESSION_A]?.running).toBe(false);
  });

  it('审批请求累积 pending(形状 = 主 store PendingApproval),收尾轮清掉本轮 pending', () => {
    const { ingest } = useBackgroundSessions.getState();
    ingest(SESSION_A, ev('t1', { type: 'turn_started' }));
    ingest(
      SESSION_A,
      ev('t1', {
        type: 'approval_request',
        request_id: 'req-1',
        kind: { type: 'tool', tool_name: 'Bash', args: { cmd: 'ls' } },
        risk: 'medium',
      }),
    );
    const snapshot = useBackgroundSessions.getState().sessions[SESSION_A];
    expect(snapshot?.pendingCount).toBe(1);
    expect(snapshot?.pending.approvals[0]).toMatchObject({
      id: 'req-1',
      kind: 'tool',
      toolName: 'Bash',
      turnId: 't1',
    });
    // turn 收尾清 pending(reducer 既有语义经复用自动成立)。
    ingest(SESSION_A, ev('t1', { type: 'turn_complete', usage: {}, status: 'done' }));
    expect(useBackgroundSessions.getState().sessions[SESSION_A]?.pendingCount).toBe(0);
  });

  it('plan 请求进 pending.plan;各会话投影互不串线', () => {
    const { ingest } = useBackgroundSessions.getState();
    ingest(SESSION_A, ev('t1', { type: 'plan_ready', plan_id: 'p1', markdown: '# plan' }));
    ingest(
      SESSION_B,
      ev('t2', {
        type: 'approval_request',
        request_id: 'req-2',
        kind: { type: 'hook', hook_name: 'gate' },
      }),
    );
    const sessions = useBackgroundSessions.getState().sessions;
    expect(sessions[SESSION_A]?.pending.plan?.id).toBe('p1');
    expect(sessions[SESSION_A]?.pending.approvals).toHaveLength(0);
    expect(sessions[SESSION_B]?.pending.approvals).toHaveLength(1);
    expect(sessions[SESSION_B]?.pending.plan).toBeNull();
  });
});

describe('backgroundSessions — demote / mergePendingInto', () => {
  it('demote 播种运行态;mergePendingInto 注回主 store 并清除条目', () => {
    const { demote, ingest, mergePendingInto } = useBackgroundSessions.getState();
    // 用户在会话 A 跑着 turn 时切走 → 播种前台投影。
    demote(SESSION_A, foregroundProjection());
    expect(useBackgroundSessions.getState().sessions[SESSION_A]?.running).toBe(true);
    // 后台积攒一个审批请求。
    ingest(
      SESSION_A,
      ev('t9', {
        type: 'approval_request',
        request_id: 'req-9',
        kind: { type: 'tool', tool_name: 'Edit', args: {} },
      }),
    );
    // 切回 A:水合后合并 → 主 store 拿到 pending,条目清除。
    mergePendingInto(SESSION_A);
    expect(useAgentStore.getState().pendingApprovals.map((a) => a.id)).toEqual(['req-9']);
    expect(useBackgroundSessions.getState().sessions[SESSION_A]).toBeUndefined();
  });

  it('demote 播种的在飞历史在切回时回到主 store(rollout 尚未落盘 assistant 消息)', () => {
    const { demote, mergePendingInto } = useBackgroundSessions.getState();
    demote(SESSION_A, foregroundProjection());
    // 切回时先按 rollout 水合(此处模拟:历史为空 —— 回合未结束,
    // assistant 消息还没落盘),再由后台投影覆盖。
    useAgentStore.setState({ turns: [] });
    mergePendingInto(SESSION_A);
    const turns = useAgentStore.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('streaming');
    expect(turns[0].items).toEqual([
      { kind: 'user_text', text: '跑起来' },
      { kind: 'assistant_text', text: '正在做' },
    ]);
    // 运行态随之恢复 → 停止按钮重新可用。
    expect(useAgentStore.getState().turns.some((turn) => turn.status === 'streaming')).toBe(true);
  });

  it('demote 播种的待审批 plan 在切回时回到主 store(审批框自动重弹)', () => {
    const { demote, mergePendingInto } = useBackgroundSessions.getState();
    demote(SESSION_A, {
      ...foregroundProjection(),
      pendingPlan: {
        id: 'p1',
        kind: 'ready',
        payload: { type: 'plan_ready', plan_id: 'p1', markdown: '# plan' },
        turnId: 't-live',
      },
    });
    expect(useBackgroundSessions.getState().sessions[SESSION_A]?.pendingCount).toBe(1);
    useAgentStore.setState({ pendingPlan: null });
    mergePendingInto(SESSION_A);
    expect(useAgentStore.getState().pendingPlan?.id).toBe('p1');
  });

  it('mergePendingInto 对无条目会话是 no-op(不动主 store pending)', () => {
    useAgentStore.setState({ pendingApprovals: [] });
    useBackgroundSessions.getState().mergePendingInto('sess-missing');
    expect(useAgentStore.getState().pendingApprovals).toEqual([]);
  });

  it('clearSession 清投影(会话删除路径)', () => {
    useBackgroundSessions.getState().demote(SESSION_A, foregroundProjection());
    useBackgroundSessions.getState().clearSession(SESSION_A);
    expect(useBackgroundSessions.getState().sessions[SESSION_A]).toBeUndefined();
  });
});
