/**
 * Vitest — Button primitive 测试（CSS Modules 版）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/render/design-system/Button';

describe('Button', () => {
  it('renders text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeDefined();
  });

  it('defaults to type=button', () => {
    render(<Button>x</Button>);
    expect(screen.getByText('x').getAttribute('type')).toBe('button');
  });

  it('accepts submit type', () => {
    render(<Button type="submit">Submit</Button>);
    const btn = screen.getByText('Submit');
    expect(btn.getAttribute('type')).toBe('submit');
  });

  it('forwards onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Action</Button>);
    screen.getByText('Action').click();
    expect(onClick).toHaveBeenCalled();
  });

  it('renders primary variant via data-variant attribute', () => {
    const { container } = render(<Button variant="primary">P</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('data-variant')).toBe('primary');
  });

  it('renders danger variant via data-variant attribute', () => {
    const { container } = render(<Button variant="danger">D</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('data-variant')).toBe('danger');
  });

  it('applies size via data-size attribute', () => {
    const { container } = render(<Button size="lg">L</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('data-size')).toBe('lg');
  });

  it('block flag sets data-block', () => {
    const { container } = render(<Button block>x</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('data-block')).toBe('true');
  });

  it('loading disables the button and shows aria-busy', () => {
    const { container } = render(<Button loading>x</Button>);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('respects explicit disabled', () => {
    const { container } = render(<Button disabled>x</Button>);
    expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
