/**
 * Vitest — 会话级思考强度偏好（effortPreference）。
 *
 * composer 选档只写线程内存槽位（Op::SetEffort），换绑（切会话 / 热重载 /
 * 切模型 / 重启）会用 `[model].reasoning_effort` 配置默认重置 —— 偏好
 * 在 bind 后由 syncEffortPreference 校准回线程槽位。无偏好 = 配置默认
 * 生效，sync 为 no-op（不发冗余 op）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import {
  readEffortPreference,
  writeEffortPreference,
  moveEffortPreference,
  syncEffortPreference,
} from './effortPreference';

beforeEach(() => {
  localStorage.clear();
  resetMockInvoke();
});

describe('per-session effort preference', () => {
  it('keeps choices separate per session and defaults to null', () => {
    writeEffortPreference('a', 'max');
    writeEffortPreference('b', 'high');
    expect(readEffortPreference('a')).toBe('max');
    expect(readEffortPreference('b')).toBe('high');
    expect(readEffortPreference('c')).toBeNull();
    // null 会话读写 'new' 预创建键。
    writeEffortPreference(null, 'max');
    expect(readEffortPreference(null)).toBe('max');
  });

  it('rejects invalid levels', () => {
    writeEffortPreference('bad', 'turbo');
    expect(readEffortPreference('bad')).toBeNull();
  });

  it('move only transfers keys that were written', () => {
    writeEffortPreference('new', 'max');
    moveEffortPreference('new', 'sess-1');
    expect(readEffortPreference('sess-1')).toBe('max');
    expect(readEffortPreference('new')).toBeNull();
    // 未写过的键：转正无副作用。
    moveEffortPreference('new', 'sess-2');
    expect(readEffortPreference('sess-2')).toBeNull();
  });
});

describe('syncEffortPreference', () => {
  it('replays zhuye_set_effort when slot differs from the preference', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_get_effort', async () => 'medium');
    mockInvoke('zhuye_set_effort', async (_c: string, args?: { level: string }) => {
      calls.push(args?.level ?? '');
      return 'sub-1';
    });
    writeEffortPreference('sess', 'max');
    await syncEffortPreference('sess');
    expect(calls).toEqual(['max']);
  });

  it('skips the op when slot already matches the preference', async () => {
    const set = vi.fn(async () => 'sub-1');
    mockInvoke('zhuye_get_effort', async () => 'max');
    mockInvoke('zhuye_set_effort', set);
    writeEffortPreference('sess', 'max');
    await syncEffortPreference('sess');
    expect(set).not.toHaveBeenCalled();
  });

  it('is a no-op without a saved preference (config default applies)', async () => {
    const get = vi.fn(async () => 'medium');
    const set = vi.fn(async () => 'sub-1');
    mockInvoke('zhuye_get_effort', get);
    mockInvoke('zhuye_set_effort', set);
    await syncEffortPreference('no-pref');
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('swallows IPC failures without throwing (fire-and-forget contract)', async () => {
    mockInvoke('zhuye_get_effort', async () => {
      throw new Error('thread not ready');
    });
    writeEffortPreference('sess', 'max');
    await expect(syncEffortPreference('sess')).resolves.toBeUndefined();
  });
});
