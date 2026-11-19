/**
 * KeyHint 工具 —— 快捷键格式化（macOS / 其他平台）。
 */

export type Platform = 'macos' | 'other';

export function platformLabel(platform: Platform): Record<string, string> {
  if (platform === 'macos') {
    return { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', esc: '⎋' };
  }
  return { cmd: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', esc: 'Esc' };
}

/** "Cmd+Enter" / "Ctrl+Enter" 形式。 */
export function shortcutLabel(combo: string, platform: Platform): string {
  const labels = platformLabel(platform);
  return combo
    .split('+')
    .map((p) => {
      const key = p.trim().toLowerCase();
      if (key === 'cmd') return labels.cmd;
      if (key === 'ctrl') return labels.ctrl;
      if (key === 'alt') return labels.alt;
      if (key === 'shift') return labels.shift;
      if (key === 'enter') return labels.enter;
      if (key === 'esc') return labels.esc;
      return p.trim();
    })
    .join(platform === 'macos' ? '' : '+');
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'macos' : 'other';
}