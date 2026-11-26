/**
 * useThemeCycle —— AppShell 的主题切换状态机。
 *
 * 把原来直接写在 AppShell 里的 theme state + `cycleTheme` 抽出来,
 * 让 AppShell 主体只关注布局。
 *
 * 行为契约(不可变):
 *   - 初始 mode 取自 `getTheme()`,resolved 取自 `getResolvedTheme()`。
 *   - `cycleTheme` 在当前实际深浅主题之间切换。
 *   - 调用 `cycleTheme()` 或 `setThemeMode()` 时同时 `setTheme()` 持久化并触发订阅,
 *     由 `subscribeTheme(setResolved)` 负责把 resolved 同步回 React state。
 *   - resolved 始终与 `getResolvedTheme()` 一致(包括系统级变化)。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getTheme,
  getResolvedTheme,
  setTheme,
  subscribeTheme,
  type ThemeMode,
} from '@/logic/harness/preferences/theme';

export interface UseThemeCycleResult {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  cycleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

export function useThemeCycle(): UseThemeCycleResult {
  const [mode, setMode] = useState<ThemeMode>(() => getTheme());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => getResolvedTheme());

  useEffect(() => subscribeTheme((value) => { setResolved(value); setMode(getTheme()); }), []);

  const cycleTheme = useCallback(() => {
    const next: ThemeMode = getResolvedTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setMode(next);
  }, []);

  const setThemeMode = useCallback((next: ThemeMode) => {
    setTheme(next);
    setMode(next);
  }, []);

  return { mode, resolved, cycleTheme, setThemeMode };
}