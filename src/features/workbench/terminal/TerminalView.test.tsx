/**
 * Vitest —— TerminalView（B8-01）。
 *
 * 冒烟测试：渲染空状态 + 验证表单/输入框存在。
 * 流式输出 + kill 由针对真实 Tauri 运行时的手动集成测试覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalView } from './TerminalView';

describe('TerminalView', () => {
  beforeEach(() => {
    // 无 —— 测试为纯展示；后端调用通过 setup.tsx 模拟。
  });

  it('renders the empty state when no sessions', () => {
    render(<TerminalView />);
    expect(screen.getByText(/No active sessions/i)).toBeDefined();
  });

  it('renders the input form', () => {
    render(<TerminalView />);
    expect(screen.getByTestId('terminal-input')).toBeDefined();
  });

  it('renders the header with Terminal label', () => {
    render(<TerminalView />);
    expect(screen.getByText('Terminal')).toBeDefined();
  });

  it('renders the placeholder hint', () => {
    render(<TerminalView />);
    expect(screen.getByText(/Type a shell command below/i)).toBeDefined();
  });
});