/**
 * theme —— 主题切换基础设施。
 *
 * 三态：'light' | 'dark' | 'system'。
 * - 持久化到 localStorage（key: `zhuye-theme`）。
 * - 写 `document.documentElement.dataset.theme`，tokens.css 据此切换。
 * - 'system' 时清除 data-theme，由 `prefers-color-scheme` 媒体查询决定。
 *
 * 阶段 1 只建基础设施；UI 切换按钮在阶段 3 的 StatusBar 接入。
 */

import type { ThemeMode } from '@/contracts/appearance';
export type { ThemeMode } from '@/contracts/appearance';
import { applyThemeAppearance } from '@/logic/webview/appearance';

const STORAGE_KEY = 'zhuye-theme';
const listeners = new Set<(resolved: 'light' | 'dark') => void>();

function resolveSystem(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'; // SSR / 测试兜底
  if (typeof window.matchMedia !== 'function') return 'dark'; // jsdom 等无 matchMedia 环境
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(mode: ThemeMode): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  applyThemeAppearance(mode);
  return resolveSystem();
}

/** 读取持久化的主题模式（默认 'system'）。 */
export function getTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

/** 解析当前实际生效的主题（'light' | 'dark'）。 */
export function getResolvedTheme(): 'light' | 'dark' {
  const mode = getTheme();
  return mode === 'system' ? resolveSystem() : mode;
}

/** 设置主题模式并持久化。返回解析后的实际主题。 */
export function setTheme(mode: ThemeMode): 'light' | 'dark' {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  const resolved = apply(mode);
  notify(resolved);
  return resolved;
}

/** 订阅主题变化（resolved 态）。返回取消订阅函数。 */
export function subscribeTheme(fn: (resolved: 'light' | 'dark') => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(resolved: 'light' | 'dark') {
  for (const fn of listeners) fn(resolved);
}

/** 在 app 启动时调用一次，把持久化的模式 apply 到 DOM。 */
export function initTheme(): () => void {
  apply(getTheme());
  // 监听系统主题变化（仅 system 模式下有意义，但订阅始终便宜）。
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getTheme() === 'system') {
        notify(resolveSystem());
      }
    };
    // addEventListener 在现代浏览器可用；Safari < 14 用 addListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }
  return () => {};
}
