import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminalView } from './TerminalView';
import type { TerminalViewProps } from '@/contracts/workbench/terminal';

describe('终端展示契约', () => {
  it('仅依据传入的数据展示输出并转发操作', () => {
    const onSubmit = vi.fn();
    const onInputChange = vi.fn();
    const props: TerminalViewProps = {
      state: {
        sessions: [{ id: 'one', command: 'pwd', cwd: '/work', status: 'exited' }],
        lines: {}, activeId: 'one', input: 'ls', busy: false,
      },
      activeLines: [{ seq: 1, stream: 'stdout', text: '/work' }],
      activeSession: { id: 'one', command: 'pwd', cwd: '/work', status: 'exited' },
      bottomRef: null,
      t: (key) => key,
      tp: (key) => key,
      onSelectSession: vi.fn(), onInputChange, onSubmit,
      onKill: vi.fn(), onClear: vi.fn(),
    };
    render(<TerminalView {...props} />);
    expect(screen.getByText('/work')).toBeDefined();
    fireEvent.change(screen.getByTestId('terminal-input'), { target: { value: 'git status' } });
    fireEvent.submit(screen.getByTestId('terminal-input').closest('form')!);
    expect(onInputChange).toHaveBeenCalledWith('git status');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
