import { describe, expect, it } from 'vitest';
import { initialTerminalState, terminalReducer } from './useTerminalController';

describe('terminal events before command response', () => {
  it('preserves early output and the exit status when the session is added', () => {
    let state = terminalReducer(initialTerminalState, {
      type: 'session/appendLine', session_id: 'id', line: { seq: 1, stream: 'stdout', text: 'hello' },
    });
    state = terminalReducer(state, {
      type: 'session/appendLine', session_id: 'id', line: { seq: 2, stream: 'exit', text: '7' },
    });
    state = terminalReducer(state, {
      type: 'session/add', session: { id: 'id', command: 'cmd', cwd: '/', status: 'running' },
      seeds: [{ seq: -1, stream: 'input', text: '$ cmd' }],
    });
    expect(state.lines.id.map((line) => line.text)).toEqual(['$ cmd', 'hello', '7']);
    expect(state.sessions[0]).toMatchObject({ status: 'exited', exitCode: 7 });
  });
});
