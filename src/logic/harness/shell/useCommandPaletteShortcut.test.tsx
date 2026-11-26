/**
 * useCommandPaletteShortcut —— ⌘K / Ctrl+K + Esc 测试。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCommandPaletteShortcut } from './useCommandPaletteShortcut';
import { useShellUi } from '@/stores/shellUi';

describe('useCommandPaletteShortcut', () => {
  // v3：开关状态迁到 shellUi store —— 用例间重置，避免跨用例污染。
  beforeEach(() => {
    useShellUi.setState({ paletteOpen: false });
  });

  afterEach(() => {
    // 无全局资源需要清理 —— 监听器在卸载时移除。
  });

  it('starts closed', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());
    expect(result.current.paletteOpen).toBe(false);
  });

  it('Cmd+K toggles paletteOpen', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });
    expect(result.current.paletteOpen).toBe(true);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });
    expect(result.current.paletteOpen).toBe(false);
  });

  it('Ctrl+K also toggles', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'K', ctrlKey: true }),
      );
    });
    expect(result.current.paletteOpen).toBe(true);
  });

  it('Escape closes when palette is open', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());
    act(() => result.current.toggle());
    expect(result.current.paletteOpen).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.paletteOpen).toBe(false);
  });

  it('Escape is no-op when palette is closed', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.paletteOpen).toBe(false);
  });

  it('does nothing when enabled=false', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut(false));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });
    expect(result.current.paletteOpen).toBe(false);
  });

  it('close() resets paletteOpen', () => {
    const { result } = renderHook(() => useCommandPaletteShortcut());
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.paletteOpen).toBe(false);
  });
});