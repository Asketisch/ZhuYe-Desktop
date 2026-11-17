/**
 * Vitest — F64/F50 OS 通知开关持久化 + Web Notification fire。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readEnabled, writeEnabled, fireNotification } from './useOsNotifications';

function fakeStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v) };
}

describe('开关持久化', () => {
  it('defaults to off', () => {
    expect(readEnabled(fakeStore())).toBe(false);
  });
  it('write/read roundtrip', () => {
    const store = fakeStore();
    writeEnabled(store, true);
    expect(readEnabled(store)).toBe(true);
    writeEnabled(store, false);
    expect(readEnabled(store)).toBe(false);
  });
});

describe('fireNotification', () => {
  const originalNotification = globalThis.Notification;

  afterEach(() => {
    vi.stubGlobal('Notification', originalNotification);
    vi.unstubAllGlobals();
  });

  it('false when Notification undefined', () => {
    vi.stubGlobal('Notification', undefined);
    expect(fireNotification('t', 'b')).toBe(false);
  });

  it('false when permission denied', () => {
    vi.stubGlobal('Notification', class {
      static permission = 'denied';
      constructor(_t: string, _o?: object) {}
    });
    expect(fireNotification('t', 'b')).toBe(false);
  });

  it('constructs notification when granted', () => {
    const captured: { title: string; body?: string }[] = [];
    vi.stubGlobal('Notification', class {
      static permission = 'granted';
      constructor(title: string, options?: { body?: string }) {
        captured.push({ title, body: options?.body });
      }
    });
    expect(fireNotification('回合完成', 'done')).toBe(true);
    expect(captured[0].title).toBe('回合完成');
    expect(captured[0].body).toBe('done');
  });
});
