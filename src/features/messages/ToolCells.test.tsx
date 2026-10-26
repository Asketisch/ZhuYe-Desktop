/**
 * Vitest — ToolCell (B7-05) + 调用/结果同框渲染。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCell } from './ToolCells';

describe('ToolCell', () => {
  it('renders header with tool name + summary', () => {
    render(<ToolCell toolName="shell" argsSummary='{"command":"ls"}' status="done" />);
    const cell = screen.getByTestId('tool-cell-shell');
    expect(cell).toBeDefined();
    expect(cell.querySelector('[class*="summary"]')?.textContent).toBe('$ ls');
  });

  it('expands args on click', () => {
    render(<ToolCell toolName="shell" argsSummary='{"command":"ls"}' status="done" />);
    const cell = screen.getByTestId('tool-cell-shell');
    expect(cell.querySelector('[data-testid="tool-args-shell"]')).toBeNull();
    fireEvent.click(cell.querySelector('button')!);
    expect(cell.querySelector('[data-testid="tool-args-shell"]')).not.toBeNull();
  });

  it('renders paired output inside the same cell (no separate box)', () => {
    render(
      <ToolCell
        toolName="shell"
        argsSummary='{"command":"ls"}'
        status="done"
        output={{ text: 'file-a\nfile-b', isError: false }}
      />,
    );
    const cell = screen.getByTestId('tool-cell-shell');
    // 收起时输出不渲染。
    expect(cell.querySelector('[data-testid="tool-cell-output"]')).toBeNull();
    fireEvent.click(cell.querySelector('button')!);
    const section = cell.querySelector('[data-testid="tool-cell-output"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('file-a');
  });

  it('renders error output with the error label + styling', () => {
    render(
      <ToolCell
        toolName="shell"
        argsSummary='{"command":"nope"}'
        status="error"
        output={{ text: 'command not found', isError: true }}
        defaultOpen
      />,
    );
    const cell = screen.getByTestId('tool-cell-shell');
    const section = cell.querySelector('[data-testid="tool-cell-output"]');
    expect(section!.textContent).toContain('command not found');
    expect(section!.querySelector('[class*="outputError"]')).not.toBeNull();
  });

  it('renders diff outputs via DiffViewer when defaultOpen', () => {
    render(
      <ToolCell
        toolName="write_file"
        argsSummary='{"path":"src/a.ts"}'
        status="done"
        defaultOpen
        output={{
          text: 'wrote 12 bytes',
          diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new',
          path: 'src/a.ts',
          isError: false,
        }}
      />,
    );
    expect(document.querySelector('[data-testid="diff-viewer"]')).not.toBeNull();
  });

  it('uses file icon for read_file', () => {
    const { container } = render(
      <ToolCell toolName="read_file" argsSummary='{"path":"/etc/passwd"}' status="done" />,
    );
    expect(container.querySelector('[data-tool="read_file"]')).toBeDefined();
    const cell = screen.getByTestId('tool-cell-read_file');
    expect(cell.querySelector('[class*="summary"]')?.textContent).toBe('/etc/passwd');
  });

  it('handles unparseable args gracefully', () => {
    render(<ToolCell toolName="shell" argsSummary="not-json" status="error" />);
    const cell = screen.getByTestId('tool-cell-shell');
    // 无法解析时，摘要回退为工具名
    expect(cell.querySelector('[class*="summary"]')?.textContent).toBe('shell');
    fireEvent.click(cell.querySelector('button')!);
    expect(screen.getByTestId('tool-args-shell').textContent).toBe('not-json');
  });

  it('falls back to generic wrench for unknown tools', () => {
    const { container } = render(
      <ToolCell toolName="my_custom_tool" argsSummary="{}" status="running" />,
    );
    expect(container.querySelector('[data-tool="my_custom_tool"]')).toBeDefined();
  });

  it('v1.5 流式参数:生成中展示 argsStream 片段,完成后可解析则切结构化摘要', () => {
    // 生成中:JSON 尚未完整 —— 头部直接展示已收到的片段。
    render(<ToolCell toolName="write_file" argsSummary="" argsStream='{"path":"src/a' status="running" />);
    const running = screen.getByTestId('tool-cell-write_file');
    expect(running.querySelector('[class*="summary"]')?.textContent).toBe('{"path":"src/a');
    fireEvent.click(running.querySelector('button')!);
    expect(screen.getByTestId('tool-args-write_file').textContent).toBe('{"path":"src/a');
  });

  it('v1.5 流式参数:argsStream 拼完整后按结构化摘要展示', () => {
    render(
      <ToolCell
        toolName="write_file"
        argsSummary=""
        argsStream='{"path":"src/a.ts","content":"hi"}'
        status="done"
      />,
    );
    const cell = screen.getByTestId('tool-cell-write_file');
    expect(cell.querySelector('[class*="summary"]')?.textContent).toBe('src/a.ts (2 chars)');
  });

  it('回放路径 argsSummary 优先于 argsStream', () => {
    render(
      <ToolCell
        toolName="shell"
        argsSummary='{"command":"ls"}'
        argsStream='{"command":"l'
        status="done"
      />,
    );
    const cell = screen.getByTestId('tool-cell-shell');
    expect(cell.querySelector('[class*="summary"]')?.textContent).toBe('$ ls');
  });
});