/**
 * useCommandPaletteShortcut —— ⌘K / Ctrl+K 切换 + Esc 关闭 命令面板。
 *
 * 行为契约(从 AppShell 抽出,不可变):
 *   - 监听 window keydown;`Cmd+K` 或 `Ctrl+K` 阻止默认行为并 toggle paletteOpen。
 *   - paletteOpen 为 true 时,Esc 关闭面板。
 *   - listener 仅在 `enabled` 为 true 时注册(默认 true,留给单测注入)。
 *   - 组件 unmount 自动清理 listener。
 */
import { useEffect } from 'react';
import { useState } from 'react';

export interface UseCommandPaletteShortcutResult {
  paletteOpen: boolean;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggle: () => void;
  close: () => void;
}

export function useCommandPaletteShortcut(enabled: boolean = true): UseCommandPaletteShortcutResult {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, paletteOpen]);

  const toggle = () => setPaletteOpen((v) => !v);
  const close = () => setPaletteOpen(false);

  return { paletteOpen, setPaletteOpen, toggle, close };
}