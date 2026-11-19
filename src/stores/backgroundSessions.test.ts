/**
 * src/stores/backgroundSessions.test.ts —— 后台会话注册表(v1.x 后台持续运行)。
 *
 * 锁定三个契约:
 * 1. ingest 复用主 reducer:后台事件驱动 running / pending 投影,形状与
 *    主 store 的 pending* 字段一致(审批/提问/plan 不漂移);
 * 2. mergePendingInto 把后台积攒的待确认交互注回主 store(gate 请求不落
 *    rollout,切回水合后必须合并,否则会话静默卡在审批上)并清除条目;
 * 3. seedRunning 播种切走时的运行态(turn_started 是前台事件,降级后的
 *    后台通道不会重发),后续 turn 收尾事件把它拉回 false。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetBackgroundScratchesForTests, useBackgroundSessions } from './backgroundSessions';
import { useAgentStore } from './agentStore';
import type { ReflectEvent } from '@/types/protocol';

function ev(id: string, msg: Record<string, unknown>): ReflectEvent {
  return { id, msg } as unknown as ReflectEvent;
}

const SESSION_A = 'sess-bg-a';
const SESSION_B = 'sess-bg-b';

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

describe('backgroundSessions — seedRunning / mergePendingInto', () => {
  it('seedRunning 播种运行态;mergePendingInto 注回主 store 并清除条目', () => {
    const { seedRunning, ingest, mergePendingInto } = useBackgroundSessions.getState();
    // 用户在会话 A 跑着 turn 时切走 → 播种。
    seedRunning(SESSION_A);
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

  it('mergePendingInto 对无条目会话是 no-op(不动主 store pending)', () => {
    useAgentStore.setState({ pendingApprovals: [] });
    useBackgroundSessions.getState().mergePendingInto('sess-missing');
    expect(useAgentStore.getState().pendingApprovals).toEqual([]);
  });

  it('clearSession 清投影(会话删除路径)', () => {
    useBackgroundSessions.getState().seedRunning(SESSION_A);
    useBackgroundSessions.getState().clearSession(SESSION_A);
    expect(useBackgroundSessions.getState().sessions[SESSION_A]).toBeUndefined();
  });
});
