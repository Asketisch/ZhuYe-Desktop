/**
 * src/stores/agent/store.test.ts —— `submit` / `submitItems` 的 `Submission.workspace` 线格式。
 *
 * v1.x:非空 workspace 注入 `Submission.workspace` 顶层;为 null/undefined 时
 * **省略字段**(线格式中不出现 `workspace: null`)—— 后端据此回退
 * `cfg.current_workspace()`(见 PROTOCOL_BRIDGE §2 `Submission.workspace`)。
 *
 * reducer 覆盖在 `agentStore.test.ts`,本文件只演练 store action 的
 * 出站负载。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from './store';
import type { ReflectSubmission } from '@/types/protocol';

describe('store.submit — Submission.workspace 线格式', () => {
  let sent: ReflectSubmission[] = [];

  beforeEach(() => {
    resetMockInvoke();
    sent = [];
    mockInvoke('reflect_submit', async (_cmd, args) => {
      sent.push((args as { submission: ReflectSubmission }).submission);
      return 'ok';
    });
  });

  it('workspace 非空时注入顶层 workspace 字段', async () => {
    await useAgentStore.getState().submit('hello', '/abs/workspace');
    expect(sent).toHaveLength(1);
    expect(sent[0].workspace).toBe('/abs/workspace');
    expect(sent[0].op.type).toBe('user_input');
  });

  it('workspace 为 null 时省略字段(后端回退 cfg.current_workspace)', async () => {
    await useAgentStore.getState().submit('hello', null);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('workspace');
  });

  it('workspace 为 undefined 时同样省略字段', async () => {
    await useAgentStore.getState().submit('hello');
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('workspace');
  });

  it('submitItems 同样注入/省略 workspace', async () => {
    await useAgentStore.getState().submitItems([{ type: 'text', text: 'hi' }], '/abs/ws');
    expect(sent[0].workspace).toBe('/abs/ws');

    await useAgentStore.getState().submitItems([{ type: 'text', text: 'hi' }], null);
    expect(sent[1]).not.toHaveProperty('workspace');
  });
});

describe('goal snapshot session lifecycle', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });

  it('ignores a snapshot that returns after the session is cleared', async () => {
    let resolveSnapshot!: (value: unknown) => void;
    mockInvoke('reflect_goal_snapshot', () => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));
    useAgentStore.getState().setGoalActive(true);
    const pending = useAgentStore.getState().syncGoalSnapshot();
    useAgentStore.getState().clearSession!();
    resolveSnapshot({ objective: 'old session' });
    await pending;
    expect(useAgentStore.getState().goalActive).toBe(false);
    expect(useAgentStore.getState().goalSnapshot).toBeNull();
  });
});


describe('session-scoped interactions', () => {
  beforeEach(() => { resetMockInvoke(); useAgentStore.getState().reset(); });

  it('clears old interactions on session change but preserves them on same-session replay', () => {
    useAgentStore.setState({
      loadedSessionId: 'old',
      pendingApprovals: [{ id: 'a', kind: 'tool', turnId: 't' }],
      pendingQuestions: [{ id: 'q', payload: {}, turnId: 't' }],
      pendingAskUser: [{ id: 'i', payload: {}, turnId: 't' }],
      pendingPlan: { id: 'p', payload: {}, turnId: 't' },
    });
    useAgentStore.getState().hydrateSession!('old', []);
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(1);
    useAgentStore.getState().hydrateSession!('new', []);
    expect(useAgentStore.getState().pendingApprovals).toEqual([]);
    expect(useAgentStore.getState().pendingQuestions).toEqual([]);
    expect(useAgentStore.getState().pendingAskUser).toEqual([]);
    expect(useAgentStore.getState().pendingPlan).toBeNull();
  });
});
