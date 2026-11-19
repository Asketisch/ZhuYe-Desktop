/**
 * useBangShell —— Composer `!` 终端直通（P3，对标 Reasonix「! 终端」语法）。
 *
 * `! <cmd>` 不进 agent 循环：经 `reflect_run_shell` 在当前工作区本地执行，
 * 输出经共享的 `reflect_terminal_output` 事件订阅按 session_id 分发到对应
 * run，`exit` / `error` 块收尾。结果只在 Composer 上方的面板本地呈现
 * （不写入会话 JSONL —— 这是用户自查环境，不是给模型的上下文）。
 *
 * 共享订阅按挂载引用计数管理，按 session_id 分发给对应 run。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onTerminalOutput,
  reflect_kill_shell,
  reflect_run_shell,
  type ReflectShellOutputChunk,
} from '@/utils/commands';

export interface BangRun {
  /** shell session id（与后端 run_shell 返回一致）。 */
  id: string;
  command: string;
  output: string;
  status: 'running' | 'done' | 'error';
}

let sharedListener: Promise<void> | null = null;
let sharedUnlisten: (() => void) | null = null;
let listenerUsers = 0;
const outputTargets = new Map<string, (chunk: ReflectShellOutputChunk) => void>();
const earlyOutput = new Map<string, ReflectShellOutputChunk[]>();
let starting = 0;

function ensureSharedListener(): Promise<void> {
  if (!sharedListener) {
    sharedListener = onTerminalOutput((chunk) => {
      const target = outputTargets.get(chunk.session_id);
      if (target) target(chunk);
      else if (starting > 0) {
        if (!earlyOutput.has(chunk.session_id) && earlyOutput.size >= 64) return;
        const events = earlyOutput.get(chunk.session_id) ?? [];
        events.push(chunk);
        if (events.length > 1000) events.shift();
        earlyOutput.set(chunk.session_id, events);
      }
    }).then((unlisten) => {
      if (listenerUsers === 0) {
        unlisten();
        sharedListener = null;
      } else {
        sharedUnlisten = unlisten;
      }
    }).catch((error) => {
      sharedListener = null;
      throw error;
    });
  }
  return sharedListener;
}

const MAX_KEEP = 5;

export function useBangShell() {
  const [runs, setRuns] = useState<BangRun[]>([]);
  const owned = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    listenerUsers += 1;
    return () => {
      mounted.current = false;
      listenerUsers -= 1;
      if (listenerUsers === 0 && sharedUnlisten) {
        sharedUnlisten();
        sharedUnlisten = null;
        sharedListener = null;
      }
      for (const id of owned.current) outputTargets.delete(id);
      owned.current.clear();
    };
  }, []);
  useEffect(() => {
    const visible = new Set(runs.map((item) => item.id));
    for (const id of owned.current) {
      if (!visible.has(id)) { outputTargets.delete(id); owned.current.delete(id); }
    }
  }, [runs]);

  const patch = useCallback((id: string, fn: (run: BangRun) => BangRun) => {
    setRuns((prev) => prev.map((run) => (run.id === id ? fn(run) : run)));
  }, []);

  const run = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      try {
        await ensureSharedListener();
        starting += 1;
        try {
          const session = await reflect_run_shell(trimmed);
          if (!mounted.current) return;
          owned.current.add(session.id);
          const target = (chunk: ReflectShellOutputChunk) => {
            if (chunk.stream === 'exit' || chunk.stream === 'error') {
              // stderr 可能在 exit 之后到达；保留路由直到面板关闭或卸载。
              const code = chunk.data.trim();
              const isError = chunk.stream === 'error' || (code !== '' && code !== '0');
              patch(session.id, (r) => ({
                ...r,
                output: chunk.stream === 'error' ? `${r.output}${chunk.data}\n` : r.output,
                status: isError ? 'error' : 'done',
              }));
            } else {
              patch(session.id, (r) => ({ ...r, output: `${r.output}${chunk.data}\n` }));
            }
          };
          outputTargets.set(session.id, target);
          setRuns((prev) => [
            { id: session.id, command: trimmed, output: '', status: 'running' as const },
            ...prev.slice(0, MAX_KEEP - 1),
          ]);
          const pending = earlyOutput.get(session.id) ?? [];
          earlyOutput.delete(session.id);
          for (const chunk of pending) target(chunk);
        } finally {
          starting -= 1;
          if (starting === 0) earlyOutput.clear();
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setRuns((prev) => [
          { id: `local-${Date.now()}`, command: trimmed, output: message, status: 'error' },
          ...prev.slice(0, MAX_KEEP - 1),
        ]);
      }
    },
    [patch],
  );

  const dismiss = useCallback((id: string) => {
    outputTargets.delete(id);
    owned.current.delete(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const kill = useCallback(
    async (id: string) => {
      if (!id.startsWith('local-')) {
        await reflect_kill_shell(id).catch(() => {/* 已退出的 run 幂等 no-op */});
      }
      dismiss(id);
    },
    [dismiss],
  );

  return { runs, run, dismiss, kill };
}
