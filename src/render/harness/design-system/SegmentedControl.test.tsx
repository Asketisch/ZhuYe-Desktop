/**
 * Vitest — SegmentedControl primitive 测试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SegmentedControl } from '@/render/harness/design-system/SegmentedControl';

const OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C', hint: 'Hint for C' },
] as const;

afterEach(cleanup);

describe('SegmentedControl', () => {
  it('renders all options as text', () => {
    render(<SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} />);
    expect(screen.getByText('Option A')).toBeDefined();
    expect(screen.getByText('Option B')).toBeDefined();
    expect(screen.getByText('Option C')).toBeDefined();
  });

  it('uses role=radiogroup on the container', () => {
    const { container } = render(<SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} />);
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  it('renders exactly one radio per option', () => {
    render(<SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(OPTIONS.length);
  });

  it('marks the selected option with aria-checked=true', () => {
    render(<SegmentedControl options={[...OPTIONS]} value="b" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain('Option B');
  });

  it('calls onChange with the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={[...OPTIONS]} value="a" onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    radios[1].click(); // Option B
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('disabled radios have disabled attribute and do not fire onChange', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={[...OPTIONS]} value="a" onChange={onChange} disabled />);
    const radios = screen.getAllByRole('radio');
    for (const r of radios) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
    radios[1].click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders hint only when stacked', () => {
    const { rerender } = render(
      <SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} />,
    );
    expect(screen.queryByText('Hint for C')).toBeNull();

    rerender(<SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} stacked />);
    expect(screen.getByText('Hint for C')).toBeDefined();
  });

  it('data-size mirrors size prop', () => {
    const { container } = render(
      <SegmentedControl options={[...OPTIONS]} value="a" onChange={() => {}} size="sm" />,
    );
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('data-size')).toBe('sm');
  });
});