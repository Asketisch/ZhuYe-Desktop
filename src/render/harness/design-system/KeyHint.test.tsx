/**
 * Vitest — KeyHint primitive 测试。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyHint } from '@/render/harness/design-system/KeyHint';

describe('KeyHint', () => {
  it('renders macos combo glyphs', () => {
    render(<KeyHint combo="Cmd+Enter" platform="macos" />);
    expect(screen.getByText('⌘↩')).toBeDefined();
  });

  it('renders other-platform combo', () => {
    render(<KeyHint combo="Ctrl+Enter" platform="other" />);
    expect(screen.getByText('Ctrl+Enter')).toBeDefined();
  });

  it('renders optional label', () => {
    render(<KeyHint combo="Esc" platform="other" label="Cancel" />);
    expect(screen.getByText('Cancel')).toBeDefined();
  });
});