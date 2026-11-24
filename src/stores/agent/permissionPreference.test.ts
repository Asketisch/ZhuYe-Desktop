/**
 * Vitest — 会话级工作模式偏好（permissionPreference）。
 *
 * 首页选「计划」只落占位线程；新会话 bind → replay 为空时据此校准，
 * 避免「进入计划模式？」重复确认框。老会话尊重 rollout，不覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { useAgentStore } from '@/stores/agentStore';
import {
  readPermissionPreference,
  writePermissionPreference,
  movePermissionPreference,
  syncPreferredPermissionMode,
} from './permissionPreference';

beforeEach(() => {
  localStorage.clear();
  useAgentStore.setState({ permissionMode: 'auto' });
});

describe('per-session permission preference', () => {
  it('keeps choices separate per session and defaults to null', () => {
    writePermissionPreference('a', 'plan');
    writePermissionPreference('b', 'prompt');
    expect(readPermissionPreference('a')).toBe('plan');
    expect(readPermissionPreference('b')).toBe('prompt');
    expect(readPermissionPreference('c')).toBeNull();
    // null 会话读 'new' 预创建键。
    writePermissionPreference(null, 'plan');
    expect(readPermissionPreference(null)).toBe('plan');
  });

  it('move only transfers keys that were written', () => {
    writePermissionPreference('new', 'plan');
    movePermissionPreference('new', 'sess-1');
    expect(readPermissionPreference('sess-1')).toBe('plan');
    expect(readPermissionPreference('new')).toBeNull();

    // 未写过的键：转正无副作用（不制造 'auto' 偏好覆盖会话默认）。
    movePermissionPreference('new', 'sess-2');
    expect(readPermissionPreference('sess-2')).toBeNull();
  });

  it('sync applies the preferred mode to brand-new sessions only', () => {
    const calls: string[] = [];
    useAgentStore.setState({
      setPermissionMode: async (next: string) => { calls.push(next); },
    });
    writePermissionPreference('pref-new', 'plan');
    useAgentStore.setState({ permissionMode: 'auto' });
    syncPreferredPermissionMode('pref-new', false);
    expect(calls).toEqual(['plan']);
  });

  it('sync skips sessions with rollout records or already-matching mode', () => {
    const calls: string[] = [];
    useAgentStore.setState({
      setPermissionMode: async (next: string) => { calls.push(next); },
    });
    writePermissionPreference('pref-old', 'plan');
    syncPreferredPermissionMode('pref-old', true);
    expect(calls).toEqual([]);

    writePermissionPreference('pref-match', 'prompt');
    useAgentStore.setState({ permissionMode: 'prompt' });
    syncPreferredPermissionMode('pref-match', false);
    expect(calls).toEqual([]);

    // 没有偏好（用户没显式选过）→ 不动作。
    syncPreferredPermissionMode('pref-none', false);
    expect(calls).toEqual([]);
  });

  it('未写过的会话不会因 localStorage 缺键触发无效 IPC（防回归）', () => {
    const spy = vi.fn(async (next: string) => { void next; });
    useAgentStore.setState({ setPermissionMode: spy });
    syncPreferredPermissionMode('never-touched', false);
    expect(spy).not.toHaveBeenCalled();
  });
});
