/**
 * useThemeCycle —— 主题切换状态机测试。
 *
 * 行为契约:
 *   - 初始 mode 取自 localStorage(`zhuye-theme`)。
 *   - cycleTheme 在实际深浅主题之间切换。
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

  it('cycleTheme switches the visible theme on every click', () => {
    setTheme('dark');
    const { result } = renderHook(() => useThemeCycle());
    expect(result.current.mode).toBe('dark');

    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('light');

    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it('setThemeMode updates React state and persists to localStorage', () => {
    const { result } = renderHook(() => useThemeCycle());
    act(() => result.current.setThemeMode('dark'));
    expect(result.current.mode).toBe('dark');
    expect(localStorage.getItem('zhuye-theme')).toBe('dark');
  });
});