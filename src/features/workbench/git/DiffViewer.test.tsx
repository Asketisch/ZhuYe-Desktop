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

  it('path 指定 ts 文件时对正文行做 Prism 行内高亮', () => {
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-const a = 1;', '+const b: number = 2;'].join('\n');
    const { container } = render(<DiffViewer diff={diff} path="src/x.ts" />);
    // Prism 产出 .token 类 span(关键字 const 着色)。
    expect(container.querySelectorAll('[data-testid="diff-viewer"] .token').length).toBeGreaterThan(0);
  });

  it('无 path 时从单文件 diff 头部解析语言', () => {
    const diff = ['diff --git a/lib.rs b/lib.rs', '@@ -1 +1 @@', '-fn a() {}', '+fn b() {}'].join('\n');
    const { container } = render(<DiffViewer diff={diff} />);
    expect(container.querySelectorAll('[data-testid="diff-viewer"] .token').length).toBeGreaterThan(0);
  });

  it('多文件 diff 与超大 diff 退回纯行级着色(无 token)', () => {
    const multi = ['diff --git a/a.ts b/a.ts', '@@ -1 +1 @@', '+x', 'diff --git a/b.ts b/b.ts', '@@ -1 +1 @@', '+y'].join('\n');
    const { container: c1 } = render(<DiffViewer diff={multi} />);
    expect(c1.querySelectorAll('[data-testid="diff-viewer"] .token').length).toBe(0);
    const big = Array.from({ length: 2100 }, (_, i) => `+line ${i}`).join('\n');
    const { container: c2 } = render(<DiffViewer diff={big} path="x.ts" />);
    expect(c2.querySelectorAll('[data-testid="diff-viewer"] .token').length).toBe(0);
  });
});
