import type { Ref } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';

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

export interface TerminalState {
  sessions: TerminalSession[];
  /** 以 session id 为键；每个列表上限为 MAX_LINES_PER_SESSION。 */
  lines: Record<string, TerminalLine[]>;
  activeId: string | null;
  input: string;
  busy: boolean;
}

export interface TerminalViewProps {
  state: TerminalState;
  activeLines: TerminalLine[];
  activeSession: TerminalSession | null;
  bottomRef: Ref<HTMLDivElement>;
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  onSelectSession: (id: string) => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onKill: () => void;
  onClear: () => void;
}
