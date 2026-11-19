import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TerminalViewProps } from '@/contracts/terminal';
import { emitMockEvent, mockInvoke, resetMockInvoke } from '@/test/setup';
import { TerminalBinding } from './TerminalBinding';
import { RendererProvider } from '@/logic/renderer/RendererProvider';
import { TerminalView } from '@/features/terminal/TerminalView';
import { renderer } from '@/render';

function AlternateTerminal({ state, activeLines, onInputChange, onSubmit }: TerminalViewProps) {
  return (
    <section>
      <input aria-label="command" value={state.input} onChange={(event) => onInputChange(event.target.value)} />
      <button onClick={onSubmit}>run</button>
      <output>{activeLines.map((line) => line.text).join('')}</output>
    </section>
  );
}

describe('终端绑定', () => {
  it('应用渲染入口可以替换路由所用终端界面', async () => {
    resetMockInvoke();
    const run = vi.fn(async () => ({ id: 'session-2', command: 'date', cwd: '/work' }));
    mockInvoke('reflect_run_shell', run);
    render(<RendererProvider renderer={{ ...renderer, TerminalView: AlternateTerminal }}><TerminalView /></RendererProvider>);
    fireEvent.change(screen.getByLabelText('command'), { target: { value: 'date' } });
    fireEvent.click(screen.getByText('run'));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    await screen.findByText(/cwd: \/work/);
    act(() => emitMockEvent('reflect_terminal_output', { session_id: 'session-2', stream: 'stdout', data: 'today', seq: 1 }));
    expect(screen.getByText(/today/)).toBeDefined();
  });

  it('替代界面使用同一控制器执行命令并显示事件', async () => {
    resetMockInvoke();
    const run = vi.fn(async () => ({ id: 'session-1', command: 'pwd', cwd: '/work' }));
    mockInvoke('reflect_run_shell', run);
    render(<TerminalBinding view={AlternateTerminal} />);
    fireEvent.change(screen.getByLabelText('command'), { target: { value: 'pwd' } });
    fireEvent.click(screen.getByText('run'));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    await screen.findByText(/cwd: \/work/);
    act(() => emitMockEvent('reflect_terminal_output', { session_id: 'session-1', stream: 'stdout', data: 'result', seq: 1 }));
    expect(screen.getByText(/result/)).toBeDefined();
  });
});
