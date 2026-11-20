/**
 * Vitest — theme 模块测试。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  getTheme,
  setTheme,
  getResolvedTheme,
  subscribeTheme,
  initTheme,
} from '@/utils/theme';

describe('theme module', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('getTheme defaults to system when localStorage is empty', () => {
    expect(getTheme()).toBe('system');
  });

  it('setTheme(dark) writes localStorage and sets data-theme', () => {
    setTheme('dark');
    expect(localStorage.getItem('zhuye-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setTheme(light) sets data-theme="light"', () => {
    setTheme('light');
    expect(localStorage.getItem('zhuye-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme(system) DELETES data-theme (so prefers-color-scheme takes over)', () => {
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('subscribeTheme receives notifications on setTheme', () => {
    const spy = vi.fn();
    const unsub = subscribeTheme(spy);
    setTheme('dark');
    expect(spy).toHaveBeenCalled();
    const callCountAfterDark = spy.mock.calls.length;
    setTheme('light');
    expect(spy.mock.calls.length).toBeGreaterThan(callCountAfterDark);
    unsub();
  });

  it('subscribeTheme unsubscribe stops callbacks', () => {
    const spy = vi.fn();
    const unsub = subscribeTheme(spy);
    setTheme('dark');
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    setTheme('light');
    // 没新调用（除了 unsubscribe 前的）。
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('getResolvedTheme returns the explicit value when not system', () => {
    setTheme('dark');
    expect(getResolvedTheme()).toBe('dark');
    setTheme('light');
    expect(getResolvedTheme()).toBe('light');
  });

  it('getResolvedTheme falls back to dark in jsdom (no matchMedia)', () => {
    // jsdom 默认无 matchMedia —— resolveSystem 返回 'dark' 兜底。
    expect(typeof window.matchMedia).not.toBe('function');
    setTheme('system');
    expect(getResolvedTheme()).toBe('dark');
  });

  it('initTheme applies persisted theme to DOM', () => {
    setTheme('dark');
    delete document.documentElement.dataset.theme;
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});