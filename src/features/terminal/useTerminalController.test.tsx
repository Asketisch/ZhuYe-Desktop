/**
 * Vitest —— useTerminalController（B8-01 重构）。
 *
 * 聚焦测试覆盖：
 *   - 输出路由（块进入正确的会话、正确的流）
 *   - exit/error 块切换会话状态
 *   - 行数上限（MAX_LINES_PER_SESSION）生效
 *   - kill 动作将状态从 running 切换到 killed
 *   - 组件在 `subscribe` resolve 前卸载时的安全清理
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  MAX_LINES_PER_SESSION,
  useTerminalController,
  type TerminalLineStream,
  type TerminalSession,
} from './useTerminalController';
import type { ReflectShellOutputChunk, ReflectShellSession } from '@/utils/commands';

type ChunkHandler = (chunk: ReflectShellOutputChunk) => void;

const handlers: ChunkHandler[] = [];

function resetSubscribeMock() {
  handlers.length = 0;
}

function makeChunk(
  session_id: string,
  stream: string,
  data: string,
  seq: number,
): ReflectShellOutputChunk {
  return { session_id, stream, data, seq };
}

function makeSubscribe(deferred: boolean) {
  return async (handler: ChunkHandler) => {
    handlers.push(handler);
    if (deferred) {
      return new Promise<() => void>((resolve) => {
        // 测试将通过 `pendingResolvers` 解决该请求。
        pendingResolvers.push(() => resolve(noopUnlisten));
      });
    }
    return Promise.resolve(noopUnlisten);
  };
}

const noopUnlisten = () => {};
const pendingResolvers: Array<() => void> = [];

function makeRun(sessions: ReflectShellSession[] = [], failWith?: Error) {
  return async (cmd: string): Promise<ReflectShellSession> => {
    if (failWith) throw failWith;
    const next = sessions.shift();
    if (next) return next;
    return { id: `s-${cmd}`, command: cmd, cwd: '/tmp' };
  };
}

function makeKill() {
  return vi.fn(async (_id: string) => {});
}

describe('useTerminalController — output routing', () => {
  it('routes stdout/stderr/info/exit chunks into the matching session', () => {
    resetSubscribeMock();
    const run = makeRun([{ id: 's-1', command: 'echo hi', cwd: '/tmp' }]);
    const { result } = renderHook(() =>
      useTerminalController({ runShell: run, killShell: makeKill(), subscribe: makeSubscribe(false) }),
    );

    act(() => {
      result.current.appendChunk(makeChunk('s-1', 'stdout', 'hello\n', 100));
      result.current.appendChunk(makeChunk('s-1', 'stderr', 'warn\n', 101));
      result.current.appendChunk(makeChunk('s-1', 'info', 'note', 102));
    });

    expect(result.current.state.lines['s-1'].map((l) => [l.stream, l.text])).toEqual([
      ['stdout', 'hello\n'],
      ['stderr', 'warn\n'],
      ['info', 'note'],
    ]);
  });

  it('falls back unknown streams to "info"', () => {
    resetSubscribeMock();
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: makeRun(),
        killShell: makeKill(),
        subscribe: makeSubscribe(false),
      }),
    );

    act(() => {
      result.current.appendChunk(makeChunk('s-x', 'mystery', 'huh', 1));
    });

    const line = result.current.state.lines['s-x']?.[0];
    expect(line?.stream).toBe<TerminalLineStream>('info');
  });
});

describe('useTerminalController — exit/error transitions', () => {
  it('marks the session exited when an exit chunk arrives', async () => {
    resetSubscribeMock();
    const run = makeRun([{ id: 's-e', command: 'true', cwd: '/tmp' }]);
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: run,
        killShell: makeKill(),
        subscribe: makeSubscribe(false),
      }),
    );

    await act(async () => {
      await result.current.run('true');
    });

    act(() => {
      result.current.appendChunk(makeChunk('s-e', 'stdout', 'done', 1));
      result.current.appendChunk(makeChunk('s-e', 'exit', '0', 2));
    });

    const sess = result.current.state.sessions.find((s) => s.id === 's-e');
    expect(sess?.status).toBe('exited');
    expect(sess?.exitCode).toBe(0);
  });

  it('leaves the exit code unknown for invalid payloads', async () => {
    resetSubscribeMock();
    const run = makeRun([{ id: 's-0', command: 'true', cwd: '/tmp' }]);
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: run,
        killShell: makeKill(),
        subscribe: makeSubscribe(false),
      }),
    );

    await act(async () => {
      await result.current.run('true');
    });

    act(() => {
      result.current.appendChunk(makeChunk('s-0', 'exit', 'not-a-number', 1));
    });

    const sess = result.current.state.sessions.find((s) => s.id === 's-0');
    expect(sess?.status).toBe('exited');
    expect(sess?.exitCode).toBeUndefined();
  });

  it('marks the session errored when an error chunk arrives', async () => {
    resetSubscribeMock();
    const run = makeRun([{ id: 's-x', command: 'cmd', cwd: '/tmp' }]);
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: run,
        killShell: makeKill(),
        subscribe: makeSubscribe(false),
      }),
    );

    await act(async () => {
      await result.current.run('cmd');
    });

    act(() => {
      result.current.appendChunk(makeChunk('s-x', 'error', 'boom', 1));
    });

    const sess = result.current.state.sessions.find((s) => s.id === 's-x');
    expect(sess?.status).toBe('errored');
  });
});

describe('useTerminalController — line cap', () => {
  it('trims to the last MAX_LINES_PER_SESSION entries when exceeded', () => {
    resetSubscribeMock();
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: makeRun(),
        killShell: makeKill(),
        subscribe: makeSubscribe(false),
      }),
    );

    const total = MAX_LINES_PER_SESSION + 100;
    act(() => {
      for (let i = 0; i < total; i++) {
        result.current.appendChunk(makeChunk('s-cap', 'stdout', `line-${i}`, i));
      }
    });

    const stored = result.current.state.lines['s-cap'] ?? [];
    expect(stored.length).toBe(MAX_LINES_PER_SESSION);
    expect(stored[0].seq).toBe(total - MAX_LINES_PER_SESSION);
    expect(stored[stored.length - 1].seq).toBe(total - 1);
  });
});

describe('useTerminalController — kill', () => {
  it('kills a running session and transitions it to "killed"', async () => {
    resetSubscribeMock();
    const run = makeRun([{ id: 's-k', command: 'sleep 1', cwd: '/tmp' }]);
    const kill = makeKill();
    const { result } = renderHook(() =>
      useTerminalController({ runShell: run, killShell: kill, subscribe: makeSubscribe(false) }),
    );

    await act(async () => {
      await result.current.run('sleep 1');
    });

    expect(
      result.current.state.sessions.find((s) => s.id === 's-k')?.status,
    ).toBe<TerminalSession['status']>('running');

    await act(async () => {
      await result.current.killActive();
    });

    expect(kill).toHaveBeenCalledWith('s-k');
    expect(result.current.state.sessions.find((s) => s.id === 's-k')?.status).toBe('killed');
  });

  it('does nothing when the active session is in a non-running state', async () => {
    resetSubscribeMock();
    const kill = makeKill();
    const run = makeRun(undefined, new Error('backend unavailable'));
    const { result } = renderHook(() =>
      useTerminalController({
        runShell: run,
        killShell: kill,
        subscribe: makeSubscribe(false),
      }),
    );

    await act(async () => {
      // 控制器吞掉后端错误并创建一个合成的错误会话
      await result.current.run('whatever');
    });

    expect(
      result.current.state.sessions.find((s) => s.command === 'whatever')?.status,
    ).toBe('errored');

    await act(async () => {
      await result.current.killActive();
    });

    expect(kill).not.toHaveBeenCalled();
  });
});

describe('terminal listener readiness and event ownership', () => {
  it('waits for the listener, buffers early events, and drops unrelated sessions', async () => {
    let handler!: ChunkHandler;
    let finishListen!: (unlisten: () => void) => void;
    let finishRun!: (session: ReflectShellSession) => void;
    const subscribe = (h: ChunkHandler) => {
      handler = h;
      return new Promise<() => void>((resolve) => { finishListen = resolve; });
    };
    const runShell = vi.fn(() => new Promise<ReflectShellSession>((resolve) => { finishRun = resolve; }));
    const { result } = renderHook(() => useTerminalController({ subscribe, runShell }));
    let running!: Promise<void>;
    act(() => { running = result.current.run('cmd'); });
    expect(runShell).not.toHaveBeenCalled();
    await act(async () => { finishListen(() => {}); await Promise.resolve(); });
    expect(runShell).toHaveBeenCalledOnce();
    act(() => {
      handler(makeChunk('other', 'stdout', 'unrelated', 1));
      handler(makeChunk('own', 'stdout', 'hello', 1));
      handler(makeChunk('own', 'exit', '0', 2));
    });
    await act(async () => { finishRun({ id: 'own', command: 'cmd', cwd: '/tmp' }); await running; });
    expect(result.current.state.lines.other).toBeUndefined();
    expect(result.current.state.lines.own.map((line) => line.text)).toEqual(['$ cmd', 'cwd: /tmp', 'hello', '0']);
    expect(result.current.state.sessions[0]).toMatchObject({ status: 'exited', exitCode: 0 });
    act(() => handler(makeChunk('another', 'stdout', 'ignored', 1)));
    expect(result.current.state.lines.another).toBeUndefined();
  });
});

describe('useTerminalController — safe listener cleanup', () => {
  it('calls unlisten when subscribe resolves after unmount', async () => {
    resetSubscribeMock();
    const unlisten = vi.fn();
    const subscribe = async (_h: ChunkHandler) => {
      return new Promise<() => void>((resolve) => {
        setTimeout(() => resolve(unlisten), 0);
      });
    };

    const { unmount } = renderHook(() =>
      useTerminalController({
        runShell: makeRun(),
        killShell: makeKill(),
        subscribe,
      }),
    );

    // 在订阅 resolve 之前卸载。
    unmount();
    // 等待足够长时间，让延迟的 resolve 触发。
    await new Promise((r) => setTimeout(r, 10));

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('calls unlisten exactly once on a normal mount/unmount cycle', async () => {
    resetSubscribeMock();
    const unlisten = vi.fn();
    const subscribe = async (_h: ChunkHandler) => {
      handlers.push(() => {});
      return Promise.resolve(unlisten);
    };

    const { unmount } = renderHook(() =>
      useTerminalController({
        runShell: makeRun(),
        killShell: makeKill(),
        subscribe,
      }),
    );

    // 让微任务完成解析
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
