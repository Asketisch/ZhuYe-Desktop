/**
 * src/stores/agent/queue.test.ts —— 跟进消息队列（C：Queue vs Steer）。
 *
 * 覆盖：入队 / 移除 / 编辑 / 排空时机（运行中不排、待处理交互不排、
 * 空闲时逐条发出）。drainQueue 的自动触发由 store.subscribe 的事件
 * 分支负责，此处直接调用 action 演练状态机。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from './store';
import type { ZhuyeSubmission } from '@/types/protocol';

describe('queuedMessages — 队列状态机', () => {
  let sent: ZhuyeSubmission[] = [];

  beforeEach(() => {
    resetMockInvoke();
    sent = [];
    mockInvoke('zhuye_submit', async (_cmd, args) => {
      sent.push((args as { submission: ZhuyeSubmission }).submission);
      return 'ok';
    });
    useAgentStore.getState().reset();
  });

  it('enqueueMessage 追加一条待发送消息（含 workspace 现场）', () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '跟进一下' }], '/abs/ws');
    const queued = useAgentStore.getState().queuedMessages;
    expect(queued).toHaveLength(1);
    expect(queued[0].text).toBe('跟进一下');
    expect(queued[0].workspace).toBe('/abs/ws');
    // 入队不触发后端提交。
    expect(sent).toHaveLength(0);
  });

  it('removeQueued / updateQueued 维护队列内容', () => {
    const store = useAgentStore.getState();
    store.enqueueMessage([{ type: 'text', text: 'v1' }]);
    store.enqueueMessage([{ type: 'text', text: 'v2' }]);
    const [first, second] = useAgentStore.getState().queuedMessages;

    useAgentStore.getState().updateQueued(first.id, 'v1-edited');
    expect(useAgentStore.getState().queuedMessages[0].items[0]).toEqual({
      type: 'text',
      text: 'v1-edited',
    });

    useAgentStore.getState().removeQueued(second.id);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(1);
    expect(useAgentStore.getState().queuedMessages[0].text).toBe('v1-edited');
  });

  it('drainQueue：turn 运行中不排空', async () => {
    useAgentStore.setState({ turns: [{ id: 't1', items: [], status: 'streaming' }] });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q1' }]);

    await useAgentStore.getState().drainQueue();

    expect(sent).toHaveLength(0);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(1);
  });

  it('drainQueue：待处理审批时暂停', async () => {
    useAgentStore.setState({
      pendingApprovals: [
        { id: 'a1', kind: 'tool', toolName: 'shell', turnId: 't1' },
      ],
    });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q1' }]);

    await useAgentStore.getState().drainQueue();

    expect(sent).toHaveLength(0);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(1);
  });

  it('drainQueue：只排空当前前台会话的队列(v1.x 后台持续运行)', async () => {
    // 会话 A 入队两条,切到会话 B 再入队一条。B 前台空闲 → drain 只发
    // B 的消息;A 的队列原样保留,等 A 回前台再排。
    useAgentStore.setState({ loadedSessionId: 'sess-a' });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'a1' }]);
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'a2' }]);
    useAgentStore.setState({ loadedSessionId: 'sess-b' });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'b1' }]);

    await useAgentStore.getState().drainQueue();
    expect(sent).toHaveLength(1);
    expect((sent[0].op as { items: { text: string }[] }).items[0].text).toBe('b1');
    const remaining = useAgentStore.getState().queuedMessages;
    expect(remaining).toHaveLength(2);
    expect(remaining.map((m) => m.text).sort()).toEqual(['a1', 'a2']);

    // 切回 A:drain 排 A 的队首,序保持。
    useAgentStore.setState({ loadedSessionId: 'sess-a', turns: [] });
    await useAgentStore.getState().drainQueue();
    expect(sent).toHaveLength(2);
    expect((sent[1].op as { items: { text: string }[] }).items[0].text).toBe('a1');
  });

  it('enqueueMessage 盖章当前会话 id(loadedSessionId 为 null 时存 undefined)', () => {
    useAgentStore.setState({ loadedSessionId: 'sess-x' });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q' }]);
    expect(useAgentStore.getState().queuedMessages[0].sessionId).toBe('sess-x');
    useAgentStore.setState({ loadedSessionId: null });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q2' }]);
    expect(useAgentStore.getState().queuedMessages[1].sessionId).toBeUndefined();
  });

  it('drainQueue：空闲时逐条发出（turn 收尾后再排下一条）', async () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q1' }]);
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q2' }]);

    await useAgentStore.getState().drainQueue();
    expect(sent).toHaveLength(1);
    expect(sent[0].op.type).toBe('user_input');
    expect((sent[0].op as { items: unknown[] }).items).toEqual([{ type: 'text', text: 'q1' }]);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(1);

    // 第一次 drain 的 submitItems 乐观插入 streaming turn —— 真实流程中
    // 由 turn_complete 事件标记 done 后，subscribe 回调再次触发 drain。
    useAgentStore.setState({
      turns: [{ id: 't1', items: [], status: 'done' }],
    });

    await useAgentStore.getState().drainQueue();
    expect(sent).toHaveLength(2);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
  });

  it('hydrateSession / clearSession 清空队列（会话切换不串消息）', () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q1' }]);
    useAgentStore.getState().hydrateSession?.('sess-1', []);
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);

    useAgentStore.getState().enqueueMessage([{ type: 'text', text: 'q2' }]);
    useAgentStore.getState().clearSession?.();
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
  });
});
