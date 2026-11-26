/**
 * Vitest — keyHints 工具测试。
 */
import { describe, it, expect } from 'vitest';
import { shortcutLabel, platformLabel } from '@/logic/design-system/utils/keyHints';

describe('shortcutLabel', () => {
  it('renders macos combo without +', () => {
    expect(shortcutLabel('Cmd+Enter', 'macos')).toBe('⌘↩');
  });

  it('renders non-macos combo with +', () => {
    expect(shortcutLabel('Ctrl+Enter', 'other')).toBe('Ctrl+Enter');
  });

  it('renders multi-modifier combo', () => {
    expect(shortcutLabel('Cmd+Shift+P', 'macos')).toBe('⌘⇧P');
    expect(shortcutLabel('Ctrl+Shift+P', 'other')).toBe('Ctrl+Shift+P');
  });

  it('renders Esc', () => {
    expect(shortcutLabel('Esc', 'macos')).toBe('⎋');
    expect(shortcutLabel('Esc', 'other')).toBe('Esc');
  });

  it('preserves unknown tokens', () => {
    expect(shortcutLabel('Cmd+K', 'macos')).toBe('⌘K');
  });
});

describe('platformLabel', () => {
  it('returns macos glyphs', () => {
    const l = platformLabel('macos');
    expect(l.cmd).toBe('⌘');
    expect(l.shift).toBe('⇧');
  });

  it('returns text labels for other', () => {
    const l = platformLabel('other');
    expect(l.cmd).toBe('Ctrl');
  });
});