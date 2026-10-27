/**
 * ToolCells —— 按工具名渲染 tool_call TurnItems（B7-05）。
 *
 * 每个 tool name(shell / file_read / file_write / web_fetch / search …)
 * 都有专属子组件:icon + args 摘要 + 可折叠 raw args。
 *
 * 调用与结果同框:配对的 tool_output（经 callId 分组,见 MessageList）
 * 作为 `output` 传入,展开后在 raw args 下方渲染输出正文 / unified diff,
 * 不再是独立的「输出」折叠框。
 */
import { useState } from 'react';
import {
  Terminal,
  FileText,
  FileEdit,
  FilePlus,
  Globe,
  Search,
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from '@/features/design-system';
import { DiffViewer } from '@/features/git/DiffViewer';
import { useI18n } from '@/utils/i18n';
import s from './ToolCells.module.css';

/** 配对 tool_output 的渲染字段（与 TurnItem tool_output 同构）。 */
export interface ToolCellOutput {
  text: string;
  diff?: string;
  path?: string;
  isError: boolean;
}

export interface ToolCellProps {
  toolName: string;
  argsSummary: string;
  /**
   * v1.5 `tool_call_args_delta` 累积的原始参数片段 —— 流式 provider 的
   * begin 事件 args 为 null,生成期间(乃至 end 后)argsSummary 恒为空,
   * 本字段是唯一可展示的参数文本;回放路径两者都有,以 argsSummary 优先。
   */
  argsStream?: string;
  status: 'running' | 'done' | 'error';
  /** 配对的工具输出 —— 有则渲染进同一框内（args 下方）。 */
  output?: ToolCellOutput;
  /** 初始展开（输出含 diff 时 MessageList 会传 true,让改动直接可见）。 */
  defaultOpen?: boolean;
}

const ICON_MAP: Record<string, LucideIcon> = {
  shell: Terminal,
  bash: Terminal,
  read_file: FileText,
  file_read: FileText,
  write_file: FileEdit,
  file_write: FileEdit,
  create_file: FilePlus,
  web_fetch: Globe,
  web_search: Search,
  search: Search,
};

function pickIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Wrench;
}

function parseArgs(args: string): Record<string, unknown> | null {
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}

function StatusIcon({ status }: { status: ToolCellProps['status'] }) {
  if (status === 'running') return <Icon icon={Loader2} size={13} className={s.spin} />;
  if (status === 'done') return <Icon icon={CheckCircle2} size={13} />;
  return <Icon icon={XCircle} size={13} />;
}

function summarize(name: string, args: Record<string, unknown> | null): string {
  if (!args) return name;
  switch (name) {
    case 'shell':
    case 'bash':
      return `$ ${args.command ?? args.cmd ?? ''}`;
    case 'read_file':
    case 'file_read':
      return `${args.path ?? args.file ?? '(no path)'}`;
    case 'write_file':
    case 'file_write':
      return `${args.path ?? args.file ?? ''} (${args.content ? `${String(args.content).length} chars` : 'edit'})`;
    case 'create_file':
      return `+ ${args.path ?? args.file ?? ''}`;
    case 'web_fetch':
    case 'web_search':
      return `${args.url ?? args.query ?? ''}`;
    default:
      return name;
  }
}

/** 工具输出正文:edit/write 的 unified diff 用 DiffViewer,其余为 mono pre。 */
export function ToolOutputBody({ text, diff, isError }: ToolCellOutput) {
  if (diff) {
    return (
      <>
        <DiffViewer diff={diff} />
        {text && <pre className={s.outputExtra}>{text}</pre>}
      </>
    );
  }
  return <pre className={`${s.output} ${isError ? s.outputError : ''}`}>{text}</pre>;
}

export function ToolCell({ toolName, argsSummary, argsStream, status, output, defaultOpen = false }: ToolCellProps) {
  const { t } = useI18n();
  const Icon2 = pickIcon(toolName);
  // 流式 provider 的 begin 携带 args:null —— 参数文本只能来自累积的
  // argsStream;回放路径 argsSummary 有完整 JSON,优先。
  const rawArgs = argsSummary || argsStream || '';
  const args = parseArgs(rawArgs);
  const summary = summarize(toolName, args);
  // 生成期间 JSON 尚未拼完整,解析不出来 —— 直接展示已收到的片段(截断),
  // 让用户看到参数正在生成;解析成功后切回结构化摘要。
  const streamingSummary =
    status === 'running' && !args && argsStream
      ? argsStream.length > 80
        ? `${argsStream.slice(0, 80)}…`
        : argsStream
      : summary;
  const [open, setOpen] = useState(defaultOpen);
  const accent = status === 'error' ? 'danger' : status === 'done' ? 'success' : 'warning';

  return (
    <div
      className={s.cell}
      data-tool={toolName}
      data-status={status}
      data-testid={`tool-cell-${toolName}`}
    >
      <button
        type="button"
        className={s.header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size={12} className={s.caret} />
        <Icon icon={Icon2} size={13} className={s[`accent_${accent}`]} />
        <span className={s.name}>{toolName}</span>
        <span className={s.summary}>{streamingSummary}</span>
        <StatusIcon status={status} />
      </button>
      {open && (
        <>
          <pre className={s.args} data-testid={`tool-args-${toolName}`}>
            {rawArgs || t('chat.tool.emptyArgs')}
          </pre>
          {output && (
            <div className={s.outputSection} data-testid="tool-cell-output">
              <div className={s.outputLabel}>
                {output.isError ? t('chat.outputError') : t('chat.output')}
              </div>
              <ToolOutputBody {...output} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
