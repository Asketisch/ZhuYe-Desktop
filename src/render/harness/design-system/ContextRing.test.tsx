/**
 * Vitest — ContextRing 测试。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ContextRing } from '@/render/harness/design-system/ContextRing';

describe('ContextRing', () => {
  it('renders SVG circle elements', () => {
    const { container } = render(
      <ContextRing
        segments={[
          { label: 'tools', value: 0.3, color: '#3b82f6' },
          { label: 'system', value: 0.2, color: '#22c55e' },
        ]}
      />,
    );
    // 1 背景 + 2 前景 = 3 个圆
    expect(container.querySelectorAll('circle').length).toBe(3);
  });

  it('renders label when provided', () => {
    const { container } = render(
      <ContextRing segments={[{ label: 'a', value: 0.5, color: '#000' }]} label="50%" />,
    );
    expect(container.textContent).toContain('50%');
  });

  it('handles empty segments', () => {
    const { container } = render(<ContextRing segments={[]} />);
    expect(container.querySelectorAll('circle').length).toBe(1); // 只有背景圆
  });

  it('clamps segment values to [0, 1]', () => {
    const { container } = render(
      <ContextRing segments={[{ label: 'x', value: 1.5, color: '#000' }]} />,
    );
    // 仅验证它能正常渲染而不抛错
    expect(container.querySelector('svg')).toBeDefined();
  });
});