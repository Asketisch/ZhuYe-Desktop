/**
 * useThemeCycle —— 主题切换状态机测试。
 *
 * 行为契约:
 *   - 初始 mode 取自 localStorage(`zhuye-theme`)。
 *   - cycleTheme:dark → light → system → dark。
 *   - setThemeMode 持久化并更新 React state。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThemeCycle } from './useThemeCycle';
import { setTheme } from '@/utils/theme';

describe('useThemeCycle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('reads initial mode from localStorage (default system)', () => {
    const { result } = renderHook(() => useThemeCycle());
    expect(result.current.mode).toBe('system');
    expect(result.current.resolved).toBeTypeOf('string');
  });

  it('cycleTheme moves dark → light → system → dark', () => {
    setTheme('dark');
    const { result } = renderHook(() => useThemeCycle());
    expect(result.current.mode).toBe('dark');

    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('light');

    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('system');

    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('setThemeMode updates React state and persists to localStorage', () => {
    const { result } = renderHook(() => useThemeCycle());
    act(() => result.current.setThemeMode('dark'));
    expect(result.current.mode).toBe('dark');
    expect(localStorage.getItem('zhuye-theme')).toBe('dark');
  });
});