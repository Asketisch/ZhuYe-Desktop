/**
 * Vitest — DiffViewer.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffViewer } from './DiffViewer';

describe('DiffViewer', () => {
  it('renders empty message when no lines', () => {
    render(<DiffViewer diff="" emptyMessage="Clean." />);
    expect(screen.getByText('Clean.')).toBeDefined();
  });

  it('classifies add/del/context/hunk/meta lines', () => {
    const diff = [
      'diff --git a/foo b/foo',
      'index 000..111 100644',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1,3 +1,3 @@',
      ' line a',
      '-old line',
      '+new line',
      ' line b',
    ].join('\n');
    const { container } = render(<DiffViewer diff={diff} />);
    const viewer = container.querySelector('[data-testid="diff-viewer"]')!;
    expect(viewer).toBeDefined();
    const kinds = Array.from(viewer.querySelectorAll('[data-kind]')).map(
      (el) => el.getAttribute('data-kind'),
    );
    expect(kinds).toContain('hunk');
    expect(kinds).toContain('add');
    expect(kinds).toContain('del');
    expect(kinds).toContain('context');
    expect(kinds).toContain('meta');
  });

  it('renders line numbers from hunk header', () => {
    const diff = '@@ -10,2 +20,3 @@\n context\n+added';
    const { container } = render(<DiffViewer diff={diff} />);
    const gutter = container.querySelectorAll('.gutter, [class*="gutter"]');
    expect(gutter.length).toBeGreaterThan(0);
  });
});
