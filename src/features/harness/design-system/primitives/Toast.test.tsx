/**
 * Vitest — Toast primitive 测试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from '@/features/harness/design-system/primitives/Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders message and kind', () => {
    render(<Toast kind="error" message="Boom" onDismiss={vi.fn()} />);
    expect(screen.getByText('Boom')).toBeDefined();
    expect(screen.getByRole('status').getAttribute('data-kind')).toBe('error');
  });

  it('auto-dismisses after durationMs', () => {
    const onDismiss = vi.fn();
    render(<Toast kind="info" message="x" durationMs={1000} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismisses on click', () => {
    const onDismiss = vi.fn();
    const { container } = render(<Toast kind="success" message="x" onDismiss={onDismiss} />);
    const btn = container.querySelector('button[aria-label="Dismiss"]')!;
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('clears timer on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast kind="info" message="x" durationMs={1000} onDismiss={onDismiss} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});