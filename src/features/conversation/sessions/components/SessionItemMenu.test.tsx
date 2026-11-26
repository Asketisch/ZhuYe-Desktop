/**
 * Vitest — SessionItemMenu 测试（Sidebar 与 ThreadsView 共用的操作菜单）。
 *
 * 验证:
 * 1. 菜单项渲染（rename / export / delete；onArchive 存在时含 archive）
 * 2. rename → 提交 input → onRename 调用 + new value
 * 3. export → onExport 调用 + toast 显示
 * 4. delete / archive → 应用内确认取消时不调用
 * 5. archive → 应用内确认同意后调用 onArchive
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionItemMenu } from '@/features/conversation/sessions/components/SessionItemMenu';
import { ConfirmDialogHost } from '@/features/harness/modals/ConfirmDialog';
import type { ZhuyeSessionInfo } from '@/utils/commands';

const SESSION: ZhuyeSessionInfo = {
  session_id: 's1',
  model: 'stub/test',
  started_at: new Date().toISOString(),
  message_count: 2,
};

const baseProps = () => ({
  session: SESSION,
  onRename: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
  onExport: vi.fn().mockResolvedValue('/tmp/out.json'),
});

describe('SessionItemMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders core actions; archive only when handler provided', () => {
    const props = baseProps();
    const { rerender } = render(<SessionItemMenu {...props} />);
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Export/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Fork/ })).toBeNull();

    rerender(<SessionItemMenu {...props} onArchive={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole('menuitem', { name: /Archive/ })).toBeDefined();

    rerender(<SessionItemMenu {...props} onFork={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole('menuitem', { name: /Fork/ })).toBeDefined();
  });

  it('opens fork form with default branch name and submits it', async () => {
    const onFork = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<SessionItemMenu {...baseProps()} onFork={onFork} />);

    fireEvent.click(container.querySelector('[data-testid="session-fork-s1"]') as HTMLButtonElement);
    const input = (await waitFor(() =>
      container.querySelector('[data-testid="session-fork-input-s1"]'),
    )) as HTMLInputElement;
    // 默认分支名与 CLI(`zhuye session fork` 无 --branch)一致。
    expect(input.value).toBe('manual');

    fireEvent.change(input, { target: { value: 'explore-rewrite' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onFork).toHaveBeenCalledWith('explore-rewrite'));
  });

  it('does not submit fork with a blank branch name', async () => {
    const onFork = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<SessionItemMenu {...baseProps()} onFork={onFork} />);

    fireEvent.click(container.querySelector('[data-testid="session-fork-s1"]') as HTMLButtonElement);
    const input = (await waitFor(() =>
      container.querySelector('[data-testid="session-fork-input-s1"]'),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onFork).not.toHaveBeenCalled();
  });

  it('opens rename input and submits new name', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <SessionItemMenu {...baseProps()} onRename={onRename} />,
    );

    const renameBtn = container.querySelector('[data-testid="session-rename-s1"]') as HTMLButtonElement;
    fireEvent.click(renameBtn);
    const input = (await waitFor(() =>
      container.querySelector('[data-testid="session-rename-input-s1"]'),
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Renamed chat' } });
    const form = input.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Renamed chat'));
  });

  it('shows toast on export', async () => {
    const { container } = render(<SessionItemMenu {...baseProps()} />);

    const exportBtn = container.querySelector('[data-testid="session-export-s1"]') as HTMLButtonElement;
    fireEvent.click(exportBtn);

    await waitFor(() => {
      const text = container.textContent ?? '';
      expect(text).toContain('Exported');
      expect(text).toContain('/tmp/out.json');
    });
  });

  it('does not delete when the in-app confirm is cancelled', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <>
        <SessionItemMenu {...baseProps()} onDelete={onDelete} />
        <ConfirmDialogHost />
      </>,
    );

    const deleteBtn = container.querySelector('[data-testid="session-delete-s1"]') as HTMLButtonElement;
    fireEvent.click(deleteBtn);
    // 应用内确认框弹出 → 取消。
    fireEvent.click(await screen.findByTestId('confirm-dialog-cancel'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes after the in-app confirm is accepted', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <>
        <SessionItemMenu {...baseProps()} onDelete={onDelete} />
        <ConfirmDialogHost />
      </>,
    );

    const deleteBtn = container.querySelector('[data-testid="session-delete-s1"]') as HTMLButtonElement;
    fireEvent.click(deleteBtn);
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });

  it('archives after the in-app confirm is accepted', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <>
        <SessionItemMenu {...baseProps()} onArchive={onArchive} />
        <ConfirmDialogHost />
      </>,
    );

    const archiveBtn = container.querySelector('[data-testid="session-archive-s1"]') as HTMLButtonElement;
    fireEvent.click(archiveBtn);
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(onArchive).toHaveBeenCalled());
  });

  it('does not archive when the in-app confirm is cancelled', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <>
        <SessionItemMenu {...baseProps()} onArchive={onArchive} />
        <ConfirmDialogHost />
      </>,
    );

    const archiveBtn = container.querySelector('[data-testid="session-archive-s1"]') as HTMLButtonElement;
    fireEvent.click(archiveBtn);
    fireEvent.click(await screen.findByTestId('confirm-dialog-cancel'));
    expect(onArchive).not.toHaveBeenCalled();
  });
});
