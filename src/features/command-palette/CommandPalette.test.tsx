/**
 * Vitest —— CommandPalette 组件（B10-01）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';

const noop = () => undefined;
const baseProps = {
  open: true,
  onClose: noop,
  navigate: noop,
  cycleTheme: noop,
  setTheme: noop as (m: 'light' | 'dark' | 'system') => void,
  resolvedTheme: 'dark' as 'dark' | 'light',
  newSession: noop,
  clearAllSessions: noop,
  exportActive: noop,
  exportActiveMarkdown: noop,
  saveConfig: noop,
  runSlash: noop,
};

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<CommandPalette {...baseProps} open={false} />);
    expect(container.querySelector('[data-testid="command-palette"]')).toBeNull();
  });

  it('renders the modal with input + nav items when open', () => {
    render(<CommandPalette {...baseProps} />);
    expect(screen.getByTestId('command-palette-input')).toBeDefined();
    // 内置导航项
    expect(screen.getByTestId('command-palette-item-nav.home')).toBeDefined();
    expect(screen.getByTestId('command-palette-item-nav.settings')).toBeDefined();
  });

  it('filters items as user types', () => {
    render(<CommandPalette {...baseProps} />);
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'settings' } });
    expect(screen.getByTestId('command-palette-item-nav.settings')).toBeDefined();
    expect(screen.queryByTestId('command-palette-item-nav.home')).toBeNull();
  });

  it('runs selected item on Enter', () => {
    const run = vi.fn();
    const navigate = vi.fn();
    render(<CommandPalette {...baseProps} navigate={navigate} runSlash={run} />);
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'home' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('Esc closes the palette', () => {
    const onClose = vi.fn();
    render(<CommandPalette {...baseProps} onClose={onClose} />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowDown / ArrowUp move active idx', () => {
    render(<CommandPalette {...baseProps} />);
    const input = screen.getByTestId('command-palette-input');
    const items = () => screen.getAllByRole('option');
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(items()[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
  });
});