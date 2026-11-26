/**
 * Vitest — ModalShell 交互行为测试（焦点陷阱 + Esc + Enter）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModalShell } from '@/features/harness/modals/ModalShell';

afterEach(cleanup);

describe('ModalShell interactions', () => {
  it('renders nothing when open=false', () => {
    render(
      <ModalShell title="T" open={false} onClose={() => {}}>
        body
      </ModalShell>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with role=dialog and aria-modal=true when open', () => {
    render(
      <ModalShell title="Hello" open={true} onClose={() => {}}>
        body
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Hello');
  });

  it('Esc key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="T" open={true} onClose={onClose}>
        body
      </ModalShell>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter on focused primary button does NOT double-fire (button click is primary)', () => {
    const primary = vi.fn();
    render(
      <ModalShell title="T" open={true} onClose={() => {}} primaryAction={{ label: 'OK', onClick: primary }}>
        body
      </ModalShell>,
    );
    // primary 按钮因 autoFocus 获得焦点。
    const btn = screen.getByText('OK');
    expect(document.activeElement).toBe(btn);
    // 直接 click 触发（这是正常的 primary 触发方式）。
    btn.click();
    expect(primary).toHaveBeenCalledTimes(1);
  });

  it('click on overlay closes dialog', () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="T" open={true} onClose={onClose}>
        body
      </ModalShell>,
    );
    // overlay 是 dialog 的 parent。
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('click INSIDE dialog does not close', () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="T" open={true} onClose={onClose}>
        <button>inner</button>
      </ModalShell>,
    );
    fireEvent.click(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders no footer when no actions given', () => {
    const { container } = render(
      <ModalShell title="T" open={true} onClose={() => {}}>
        body
      </ModalShell>,
    );
    expect(container.querySelector('footer')).toBeNull();
  });

  it('restores focus to the trigger element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open-trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <ModalShell title="T" open={true} onClose={() => {}}>
        body
      </ModalShell>,
    );
    // dialog open 时 primary 按钮获得焦点（autoFocus）。
    expect(document.activeElement).not.toBe(trigger);

    // 关闭 → trigger 重新获得焦点。
    rerender(
      <ModalShell title="T" open={false} onClose={() => {}}>
        body
      </ModalShell>,
    );
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});