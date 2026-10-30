/**
 * Terminal —— controller hook (B8-01 重构)。
 *
 * 封装状态 + 事件编排，使视图组件保持纯展示。职责：
 *   - sessions[] / lines{} / activeId / input / busy
 *   - 一次性 `onTerminalOutput` 订阅，如果组件在 `listen` promise
 *     解析前卸载，则安全清理。
 *   - run / kill / clear 动作。
 *
 * 从 TerminalView 抽取（2026-07-25）；行为已保留。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  onTerminalOutput,
  reflect_kill_shell,
  reflect_run_shell,
  type ReflectShellOutputChunk,
  type ReflectShellSession,
} from '@/utils/commands';

export type TerminalLineStream =
  | 'stdout'
  | 'stderr'
  | 'exit'
  | 'error'
  | 'info'
  | 'input';

export interface TerminalLine {
  /** 每次 session 的单调递增序列号；作为稳定 key 渲染。 */
  seq: number;
  stream: TerminalLineStream;
  text: string;
}

export interface TerminalSession {
  id: string;
  command: string;
  cwd: string;
  status: 'running' | 'exited' | 'killed' | 'errored';
  exitCode?: number;
}

export const MAX_LINES_PER_SESSION = 5_000;

export interface TerminalState {
  sessions: TerminalSession[];
  /** 以 session id 为键；每个列表上限为 MAX_LINES_PER_SESSION。 */
  lines: Record<string, TerminalLine[]>;
  activeId: string | null;
  input: string;
  busy: boolean;
}

export const initialTerminalState: TerminalState = {
  sessions: [],
  lines: {},
  activeId: null,
  input: '',
  busy: false,
};

type Action =
  | { type: 'input/set'; value: string }
  | { type: 'busy/set'; value: boolean }
  | { type: 'session/add'; session: TerminalSession; seeds: TerminalLine[] }
  | { type: 'session/appendLine'; session_id: string; line: TerminalLine }
  | { type: 'session/setStatus'; session_id: string; status: TerminalSession['status']; exitCode?: number }
  | { type: 'active/set'; id: string | null }
  | { type: 'clear'; id: string };

function trimLines(list: TerminalLine[]): TerminalLine[] {
  return list.length > MAX_LINES_PER_SESSION
    ? list.slice(list.length - MAX_LINES_PER_SESSION)
    : list;
}

function coerceStream(s: string): TerminalLineStream {
  return s === 'stdout' || s === 'stderr' || s === 'exit' || s === 'error'
    ? s
    : 'info';
}

export function terminalReducer(state: TerminalState, action: Action): TerminalState {
  switch (action.type) {
    case 'input/set':
      return { ...state, input: action.value };
    case 'busy/set':
      return { ...state, busy: action.value };
    case 'session/add': {
      const { session, seeds } = action;
      const earlyLines = state.lines[session.id] ?? [];
      const terminal = [...earlyLines].reverse().find((line) => line.stream === 'exit' || line.stream === 'error');
      const parsed = terminal?.stream === 'exit' && terminal.text.trim() !== '' ? Number(terminal.text) : NaN;
      const initialized = terminal
        ? { ...session, status: terminal.stream === 'exit' ? 'exited' as const : 'errored' as const,
            ...(Number.isFinite(parsed) ? { exitCode: parsed } : {}) }
        : session;
      return {
        ...state,
        sessions: [...state.sessions, initialized],
        lines: { ...state.lines, [session.id]: trimLines([...seeds, ...earlyLines]) },
        activeId: session.id,
      };
    }
    case 'session/appendLine': {
      const { session_id, line } = action;
      const current = state.lines[session_id] ?? [];
      const next = trimLines([...current, line]);
      return { ...state, lines: { ...state.lines, [session_id]: next } };
    }
    case 'session/setStatus': {
      const { session_id, status, exitCode } = action;
      return {
        ...state,
        sessions: state.sessions.map((sess) =>
          sess.id === session_id
            ? { ...sess, status, exitCode: exitCode ?? sess.exitCode }
            : sess,
        ),
      };
    }
    case 'active/set':
      return { ...state, activeId: action.id };
    case 'clear':
      return { ...state, lines: { ...state.lines, [action.id]: [] } };
    default:
      return state;
  }
}

export interface TerminalController {
  state: TerminalState;
  activeLines: TerminalLine[];
  activeSession: TerminalSession | null;
  setInput: (value: string) => void;
  selectSession: (id: string) => void;
  /** 运行命令；如果后端失败则创建合成错误 session。 */
  run: (command: string) => Promise<void>;
  /** 终止仍在运行的活动会话。 */
  killActive: () => Promise<void>;
  /** 清除活动会话的可见输出。 */
  clearActive: () => void;
  /**
   * 追加一个输出块 —— 用于测试和回放缓冲输出。
   * 传入 `onTerminalOutput` 返回的原始块结构。
   */
  appendChunk: (chunk: ReflectShellOutputChunk) => void;
}

export interface UseTerminalControllerOptions {
  /** 供测试覆盖。 */
  runShell?: typeof reflect_run_shell;
  /** 供测试覆盖。 */
  killShell?: typeof reflect_kill_shell;
  /** 供测试覆盖。 */
  subscribe?: (handler: (chunk: ReflectShellOutputChunk) => void) => Promise<() => void>;
}

/**
 * Terminal 视图的有状态控制器。
 *
 * `listen` 调用返回一个 Promise —— 如果组件在它 resolve 前卸载，
 * 我们仍会通过捕获的清理函数 unlisten。
 * “已 resolve” 和 “卸载后才 resolve” 两条路径
 * 都通过将 unlisten 暂存到 ref 并在拆除时清理来处理。
 */
export function useTerminalController(opts: UseTerminalControllerOptions = {}): TerminalController {
  const runShell = opts.runShell ?? reflect_run_shell;
  const killShell = opts.killShell ?? reflect_kill_shell;
  const subscribe = opts.subscribe ?? onTerminalOutput;

  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);
  const unlistenRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const listenerReady = useRef<Promise<void> | null>(null);
  const knownSessions = useRef(new Set<string>());
  const earlyOutput = useRef(new Map<string, ReflectShellOutputChunk[]>());
  const starting = useRef(0);

  const appendChunk = useCallback((chunk: ReflectShellOutputChunk) => {
    dispatch({
      type: 'session/appendLine', session_id: chunk.session_id,
      line: { seq: chunk.seq, stream: coerceStream(chunk.stream), text: chunk.data },
    });
    if (chunk.stream === 'exit') {
      const parsed = chunk.data.trim() === '' ? NaN : Number(chunk.data);
      dispatch({ type: 'session/setStatus', session_id: chunk.session_id, status: 'exited',
        exitCode: Number.isFinite(parsed) ? parsed : undefined });
    } else if (chunk.stream === 'error') {
      dispatch({ type: 'session/setStatus', session_id: chunk.session_id, status: 'errored' });
    }
  }, []);

  // 挂载时订阅一次；无论解析顺序如何，卸载时都要拆除。
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const handler = (chunk: ReflectShellOutputChunk) => {
      if (!mountedRef.current) return;
      if (knownSessions.current.has(chunk.session_id)) {
        appendChunk(chunk);
      } else if (starting.current > 0) {
        const buffers = earlyOutput.current;
        if (!buffers.has(chunk.session_id) && buffers.size >= 64) return;
        const events = buffers.get(chunk.session_id) ?? [];
        events.push(chunk);
        if (events.length > MAX_LINES_PER_SESSION) events.shift();
        buffers.set(chunk.session_id, events);
      }
    };

    const ready = subscribe(handler).then((un) => {
      if (cancelled) {
        try { un(); } catch { /* noop — best effort */ }
        return;
      }
      unlistenRef.current = un;
    });
    // 避免无人等待时的未处理 rejection，同时让 run 可以读取原始错误。
    void ready.catch(() => {});
    listenerReady.current = ready;

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (listenerReady.current === ready) listenerReady.current = null;
      const un = unlistenRef.current;
      if (un) {
        unlistenRef.current = null;
        try { un(); } catch { /* noop — best effort */ }
      }
    };
  }, [subscribe, appendChunk]);

  const setInput = useCallback((value: string) => {
    dispatch({ type: 'input/set', value });
  }, []);

  const selectSession = useCallback((id: string) => {
    dispatch({ type: 'active/set', id });
  }, []);

  const run = useCallback(
    async (command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      dispatch({ type: 'busy/set', value: true });
      dispatch({ type: 'input/set', value: '' });
      try {
        const ready = listenerReady.current;
        if (!ready) throw new Error('terminal listener is not ready');
        await ready;
        if (!mountedRef.current) return;
        starting.current += 1;
        let sess: ReflectShellSession;
        try {
          sess = await runShell(cmd);
          if (!mountedRef.current) return;
          knownSessions.current.add(sess.id);
          dispatch({
          type: 'session/add',
          session: {
            id: sess.id,
            command: sess.command,
            cwd: sess.cwd,
            status: 'running',
          },
          seeds: [
            // 负数序列号与后端从 1 开始的输出序号区分。
            { seq: -2, stream: 'input', text: `$ ${cmd}` },
            { seq: -1, stream: 'info', text: `cwd: ${sess.cwd}` },
          ],
          });
          const buffered = earlyOutput.current.get(sess.id) ?? [];
          earlyOutput.current.delete(sess.id);
          for (const chunk of buffered) appendChunk(chunk);
        } finally {
          starting.current -= 1;
          if (starting.current === 0) earlyOutput.current.clear();
        }
      } catch (e) {
        // 合成错误会话，让用户就地看到失败信息。
        const errId = `err-${Date.now()}`;
        const message = e instanceof Error ? e.message : String(e);
        dispatch({
          type: 'session/add',
          session: { id: errId, command: cmd, cwd: '', status: 'errored' },
          seeds: [{ seq: 0, stream: 'error', text: message }],
        });
      } finally {
        dispatch({ type: 'busy/set', value: false });
      }
    },
    [runShell, appendChunk],
  );

  const killActive = useCallback(async () => {
    if (!state.activeId) return;
    const target = state.sessions.find((s) => s.id === state.activeId);
    if (!target || target.status !== 'running') return;
    await killShell(state.activeId);
    dispatch({
      type: 'session/setStatus',
      session_id: state.activeId,
      status: 'killed',
    });
  }, [killShell, state.activeId, state.sessions]);

  const clearActive = useCallback(() => {
    if (!state.activeId) return;
    dispatch({ type: 'clear', id: state.activeId });
  }, [state.activeId]);


  const activeLines = useMemo(
    () => (state.activeId ? state.lines[state.activeId] ?? [] : []),
    [state.activeId, state.lines],
  );
  const activeSession = useMemo(
    () => state.sessions.find((sess) => sess.id === state.activeId) ?? null,
    [state.sessions, state.activeId],
  );

  return {
    state,
    activeLines,
    activeSession,
    setInput,
    selectSession,
    run,
    killActive,
    clearActive,
    appendChunk,
  };
}
