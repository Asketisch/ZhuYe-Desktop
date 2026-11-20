import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { unsubscribeMock, subscribeAgentEventMock } = vi.hoisted(() => {
  const unsubscribeMock = vi.fn();
  return {
    unsubscribeMock,
    subscribeAgentEventMock: vi.fn(() => unsubscribeMock),
  };
});

vi.mock('@/services/agentEventBus', () => ({
  subscribeAgentEvent: subscribeAgentEventMock,
}));

import {
  loadNotifyOptions,
  saveNotifyOptions,
  shouldNotifyTurnComplete,
  truncateBody,
  useAgentNotifications,
  type AgentNotifyOptions,
} from '@/utils/notify';

const STORAGE_KEY = 'zhuye.notify.options';

describe('notify options', () => {
  beforeEach(() => {
    localStorage.clear();
    subscribeAgentEventMock.mockClear();
    unsubscribeMock.mockClear();
  });

  it('normalizes stored partial options with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound: true }));

    expect(loadNotifyOptions()).toEqual({
      sound: true,
      system: false,
      volume: 0.4,
      onlyUnfocused: true,
      minDurationMs: 60_000,
      notifyApproval: true,
      dockBadge: false,
    });
  });

  it('falls back to normalized defaults for invalid storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');

    expect(loadNotifyOptions()).toEqual({
      sound: false,
      system: false,
      volume: 0.4,
      onlyUnfocused: true,
      minDurationMs: 60_000,
      notifyApproval: true,
      dockBadge: false,
    });
  });

  it('saves options in the storage format loadNotifyOptions consumes', () => {
    const options: AgentNotifyOptions = { sound: false, system: false, volume: 0.2 };

    saveNotifyOptions(options);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(options);
    // 读取侧对缺省字段做归一化补全。
    expect(loadNotifyOptions()).toEqual({
      ...options,
      onlyUnfocused: true,
      minDurationMs: 60_000,
      notifyApproval: true,
      dockBadge: false,
    });
  });
});

describe('shouldNotifyTurnComplete — 通知门控', () => {
  const base = { system: true, onlyUnfocused: true, minDurationMs: 60_000 };
  const notifyable = { focused: false, durationMs: 61_000, lastNotifiedAt: undefined, now: 1_000 };

  it('passes when unfocused + long enough + not throttled', () => {
    expect(shouldNotifyTurnComplete(notifyable, base)).toBe(true);
  });

  it('blocks when the window is focused', () => {
    expect(shouldNotifyTurnComplete({ ...notifyable, focused: true }, base)).toBe(false);
  });

  it('blocks short turns below the minimum duration', () => {
    expect(shouldNotifyTurnComplete({ ...notifyable, durationMs: 5_000 }, base)).toBe(false);
  });

  it('minDurationMs = 0 disables the duration gate', () => {
    const opts = { ...base, minDurationMs: 0 };
    expect(shouldNotifyTurnComplete({ ...notifyable, durationMs: 500 }, opts)).toBe(true);
  });

  it('blocks when no turn start was recorded (durationMs null)', () => {
    expect(shouldNotifyTurnComplete({ ...notifyable, durationMs: null }, base)).toBe(false);
  });

  it('blocks within the throttle window', () => {
    expect(
      shouldNotifyTurnComplete({ ...notifyable, lastNotifiedAt: 500, now: 1_500 }, base),
    ).toBe(false);
    expect(
      shouldNotifyTurnComplete({ ...notifyable, lastNotifiedAt: 500, now: 2_100 }, base),
    ).toBe(true);
  });

  it('blocks when system notifications are disabled', () => {
    expect(shouldNotifyTurnComplete(notifyable, { ...base, system: false })).toBe(false);
  });
});

describe('truncateBody', () => {
  it('keeps short text as-is', () => {
    expect(truncateBody('hello')).toBe('hello');
  });

  it('truncates long text with an ellipsis', () => {
    const out = truncateBody('a'.repeat(300));
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('useAgentNotifications', () => {
  beforeEach(() => {
    subscribeAgentEventMock.mockClear();
    unsubscribeMock.mockClear();
  });

  it('subscribes through the shared event bus and cleans up on unmount', () => {
    const options: AgentNotifyOptions = { sound: false, system: false, volume: 0.4 };
    const { unmount } = renderHook(() => useAgentNotifications(options));

    expect(subscribeAgentEventMock).toHaveBeenCalledOnce();
    expect(subscribeAgentEventMock).toHaveBeenCalledWith(expect.any(Function));
    expect(unsubscribeMock).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });
});
