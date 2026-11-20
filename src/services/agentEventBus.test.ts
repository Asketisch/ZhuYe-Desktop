/**
 * src/services/agentEventBus.test.ts —— 扇出事件总线单元测试（B1-06）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 我们模拟 @/utils/commands 以捕获 onZhuyeEvent 订阅调用。
const subscribeMock = vi.fn();
const unlistenMock = vi.fn();
vi.mock('@/utils/commands', () => ({
  onZhuyeEvent: (h: (e: unknown) => void) => {
    subscribeMock(h);
    return Promise.resolve(unlistenMock);
  },
}));

import {
  subscribeAgentEvent,
  __resetAgentEventBusForTests,
  agentEventBusSubscriberCount,
} from './agentEventBus';

describe('agentEventBus', () => {
  beforeEach(() => {
    __resetAgentEventBusForTests();
    subscribeMock.mockClear();
    unlistenMock.mockClear();
  });

  afterEach(() => {
    __resetAgentEventBusForTests();
  });

  it('opens a single Tauri listener on first subscribe', async () => {
    const a = vi.fn();
    subscribeAgentEvent(a);
    // 等待一个微任务，让异步 openListener 完成解析。
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(agentEventBusSubscriberCount()).toBe(1);
  });

  it('shares the listener across multiple subscribers', async () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeAgentEvent(a);
    subscribeAgentEvent(b);
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(agentEventBusSubscriberCount()).toBe(2);
  });

  it('fans out events to all subscribers', async () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeAgentEvent(a);
    subscribeAgentEvent(b);
    await new Promise((r) => setTimeout(r, 0));
    // 找到已注册的 handler 并调用它。
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const handler = subscribeMock.mock.calls[0][0] as (e: unknown) => void;
    handler({ id: 't1', msg: { type: 'agent_message', text: 'hi' } });
    expect(a).toHaveBeenCalledWith({ id: 't1', msg: { type: 'agent_message', text: 'hi' } });
    expect(b).toHaveBeenCalledWith({ id: 't1', msg: { type: 'agent_message', text: 'hi' } });
  });

  it('isolates throwing consumers', async () => {
    const a = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    subscribeAgentEvent(a);
    subscribeAgentEvent(b);
    await new Promise((r) => setTimeout(r, 0));
    const handler = subscribeMock.mock.calls[0][0] as (e: unknown) => void;
    // 测试期间抑制总线产生的 console.error。
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handler({ id: 'x', msg: { type: 'turn_started', turn_id: 'x' } });
    expect(b).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('unsubscribes a single handler without closing the listener', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeAgentEvent(a);
    subscribeAgentEvent(b);
    await new Promise((r) => setTimeout(r, 0));
    unA();
    expect(agentEventBusSubscriberCount()).toBe(1);
    expect(unlistenMock).not.toHaveBeenCalled();
  });

  it('closes the listener when last subscriber unsubscribes', async () => {
    const a = vi.fn();
    const unA = subscribeAgentEvent(a);
    await new Promise((r) => setTimeout(r, 0));
    unA();
    expect(agentEventBusSubscriberCount()).toBe(0);
    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  it('idempotent re-subscribe of the same handler is a no-op', async () => {
    const a = vi.fn();
    const un1 = subscribeAgentEvent(a);
    const un2 = subscribeAgentEvent(a);
    await new Promise((r) => setTimeout(r, 0));
    expect(agentEventBusSubscriberCount()).toBe(1);
    un1();
    un2();
  });
});
