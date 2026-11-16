/**
 * Vitest — F52 ScmChanges 会话内文件变更面板(纯函数派生 + 渲染)。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScmChanges, deriveChangesFromTurn, groupChangesByTurn } from './ScmChanges';
import { useAgentStore, type Turn } from '@/stores/agentStore';

function turnWithWrite(id: string, path: string, opts?: { failed?: boolean }): Turn {
  return {
    id,
    status: 'done',
    items: [
      { kind: 'tool_call', toolName: 'edit', argsSummary: `{"path":"${path}"}`, callId: 'c1', status: 'done' },
      {
        kind: 'tool_output',
        callId: 'c1',
        text: 'ok',
        isError: opts?.failed ?? false,
        path,
      },
    ],
  };
}

describe('deriveChangesFromTurn (纯函数)', () => {
  it('extracts write-tool paths', () => {
    const changes = deriveChangesFromTurn(turnWithWrite('t1', 'src/lib.rs'));
    expect(changes).toEqual([{ turnId: 't1', path: 'src/lib.rs', isError: false }]);
  });

  it('ignores read-only tools', () => {
    const t: Turn = {
      id: 't',
      status: 'done',
      items: [
        { kind: 'tool_call', toolName: 'read_file', argsSummary: '{"path":"a"}', callId: 'c', status: 'done' },
        { kind: 'tool_output', callId: 'c', text: 'x', isError: false, path: 'a' },
      ],
    };
    expect(deriveChangesFromTurn(t)).toEqual([]);
  });

  it('dedups same path in one turn', () => {
    const t: Turn = {
      id: 't',
      status: 'done',
      items: [
        { kind: 'tool_call', toolName: 'edit', argsSummary: '{"path":"a"}', callId: 'c1', status: 'done' },
        { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: 'a' },
        { kind: 'tool_call', toolName: 'edit', argsSummary: '{"path":"a"}', callId: 'c2', status: 'done' },
        { kind: 'tool_output', callId: 'c2', text: '', isError: false, path: 'a' },
      ],
    };
    expect(deriveChangesFromTurn(t).length).toBe(1);
  });
});

describe('groupChangesByTurn', () => {
  it('filters out turns without changes', () => {
    const turns = [turnWithWrite('t1', 'a.rs'), { id: 't2', status: 'done' as const, items: [{ kind: 'user_text', text: 'hi' }] as Turn['items'] }];
    const groups = groupChangesByTurn(turns);
    expect(groups.length).toBe(1);
    expect(groups[0].turnId).toBe('t1');
  });
});

describe('ScmChanges component', () => {
  it('hidden when no write changes', () => {
    useAgentStore.setState({ turns: [{ id: 't', status: 'done' as const, items: [{ kind: 'user_text', text: 'hi' }] as Turn['items'] }] });
    render(<ScmChanges />);
    expect(screen.queryByTestId('scm-changes')).toBeNull();
  });

  it('renders panel with file rows', () => {
    useAgentStore.setState({ turns: [turnWithWrite('t1', 'src/lib.rs')] });
    render(<ScmChanges />);
    expect(screen.getByTestId('scm-changes')).toBeDefined();
    expect(screen.getByTestId('scm-change-row').textContent).toContain('src/lib.rs');
    expect(screen.getByText(/改动 1 个文件/)).toBeDefined();
  });

  it('marks failed changes', () => {
    useAgentStore.setState({ turns: [turnWithWrite('t1', 'a.rs', { failed: true })] });
    render(<ScmChanges />);
    expect(screen.getByTestId('scm-change-row').textContent).toContain('失败');
  });
});
