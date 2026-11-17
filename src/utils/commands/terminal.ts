/**
 * 终端 / shell 执行包装 —— spawn/kill/list + 输出订阅。
 *
 * 输出块通过 `reflect_terminal_output` 事件流式送达。前端
 * 通过 `onTerminalOutput` 每个会话订阅一次，并按 `session_id` 过滤。
 */
import { invoke, listen } from '../bridge';

export async function reflect_pty_start(id: string, cols: number, rows: number): Promise<void> { return invoke<void>('reflect_pty_start', { id, cols, rows }); }
export async function reflect_pty_write(id: string, data: string): Promise<void> { return invoke<void>('reflect_pty_write', { id, data }); }
export async function reflect_pty_resize(id: string, cols: number, rows: number): Promise<void> { return invoke<void>('reflect_pty_resize', { id, cols, rows }); }
export async function reflect_pty_close(id: string): Promise<void> { return invoke<void>('reflect_pty_close', { id }); }
export const onPtyOutput = (handler: (output: { id: string; data: number[] }) => void) =>
  listen<{ id: string; data: number[] }>('reflect_pty_output', (e) => handler(e.payload));
export const onPtyExit = (handler: (id: string) => void) => listen<string>('reflect_pty_exit', (e) => handler(e.payload));

export interface ReflectShellSession {
  id: string;
  command: string;
  cwd: string;
}

export interface ReflectShellOutputChunk {
  session_id: string;
  /** "stdout" | "stderr" | "exit" | "error". */
  stream: string;
  data: string;
  seq: number;
}

/** 启动 shell 命令；输出以 `reflect_terminal_output` 事件流式返回。 */
export async function reflect_run_shell(cmd: string, sshHost?: string): Promise<ReflectShellSession> {
  return invoke<ReflectShellSession>('reflect_run_shell', { cmd, sshHost: sshHost ?? null });
}

/** 按 id 终止运行中的 shell 会话。幂等。 */
export async function reflect_kill_shell(session_id: string): Promise<void> {
  // Tauri 2 平铺参数按 camelCase 匹配 Rust 参数名 `session_id`。
  return invoke<void>('reflect_kill_shell', { sessionId: session_id });
}

/** Diagnostic：列出活动 shell 会话的 id。 */
export async function reflect_list_shell_sessions(): Promise<string[]> {
  return invoke<string[]>('reflect_list_shell_sessions');
}

/** 订阅任意会话的终端输出事件。 */
export async function onTerminalOutput(handler: (chunk: ReflectShellOutputChunk) => void) {
  return listen<ReflectShellOutputChunk>('reflect_terminal_output', (e) => handler(e.payload));
}
