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
import { useEffect, useState, type ReactNode } from 'react';
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
import { Icon } from '@/features/harness/design-system';
import { DiffViewer } from '@/features/workbench/git/DiffViewer';
import { useI18n } from '@/utils/i18n';
import s from '@/render/conversation/messages/ToolCells.module.css';

/** 配对 tool_output 的渲染字段（与 TurnItem tool_output 同构）。 */
export interface ToolCellOutput {
  text: string;
  diff?: string;
  path?: string;
  isError: boolean;
  /** F01:prompt_guard 裁决标注(review=可疑保留 / block=已拦截),无则不渲染徽标。 */
  guardVerdict?: 'review' | 'block';
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
  /** 组内扁平行：去掉卡片边框/底色，缩进在聚合组的竖线之下。 */
  flat?: boolean;
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

/** 计划类工具：参数里带整篇 plan markdown，正文改由右侧面板渲染。 */
const PLAN_TOOLS = new Set(['exit_plan_mode', 'plan_write', 'plan_update']);

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

export function ToolCell({ toolName, argsSummary, argsStream, status, output, defaultOpen = false, flat = false }: ToolCellProps) {
  const { t } = useI18n();
  const Icon2 = pickIcon(toolName);
  // 流式 provider 的 begin 携带 args:null —— 参数文本只能来自累积的
  // argsStream;回放路径 argsSummary 有完整 JSON,优先。
  const rawArgs = argsSummary || argsStream || '';
  const args = parseArgs(rawArgs);
  const isFollowUp = toolName.startsWith('call_') && typeof args?.session_id === 'string' && args.session_id.length > 0;
  const summary = isFollowUp ? t('chat.subagent.followUp') : summarize(toolName, args);
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
  const isPlanTool = PLAN_TOOLS.has(toolName);

  return (
    <div
      className={flat ? `${s.cell} ${s.flat}` : s.cell}
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
        {output?.guardVerdict && (
          <span
            className={`${s.guardBadge} ${output.guardVerdict === 'block' ? s.guardBadgeBlock : ''}`}
            data-testid={`tool-guard-${output.guardVerdict}`}
            title={
              output.guardVerdict === 'block'
                ? t('chat.guardBadge.block')
                : t('chat.guardBadge.review')
            }
          >
            🛡 {output.guardVerdict === 'block' ? t('chat.guardBadge.block') : t('chat.guardBadge.review')}
          </span>
        )}
        <StatusIcon status={status} />
      </button>
      {open && (
        <>
          {isPlanTool ? (
            /* 计划类工具的 args 里塞的是整篇 plan markdown —— 原文只在
               右侧面板渲染,会话里不再倾泻（见 chat.tool.planBodyHint）。 */
            <pre className={s.args} data-testid={`tool-args-${toolName}`}>
              {t('chat.tool.planBodyHint')}
            </pre>
          ) : (
            <pre className={s.args} data-testid={`tool-args-${toolName}`}>
              {rawArgs || t('chat.tool.emptyArgs')}
            </pre>
          )}
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

/** 计划类工具：参数里带整篇 plan markdown，正文改由右侧面板渲染。 */

export interface ToolGroupProps {
  /** 组内工具名（去重保序）—— 摘要行展示。 */
  toolNames: string[];
  /** 组内工具调用总次数 —— 摘要行右侧的计数徽标。 */
  count: number;
  /** 初始展开（组内有 diff 输出时由 MessageList 传 true）。 */
  defaultOpen?: boolean;
  /** 组内是否有子代理续派。 */
  hasFollowUp?: boolean;
  /** 组内工具单元（ToolCell）。 */
  children: ReactNode;
}

/**
 * 工具调用聚合组 —— 连续的工具调用折叠成一行摘要（对话式 agent 产品惯例）。
 *
 * 会话默认只露出「模型动过什么」的一行摘要，具体参数与输出留在折叠层内；
 * 思考过程同理默认折叠，会话里默认只显示模型的真实输出。
 */
export function ToolGroup({ toolNames, count, defaultOpen = false, hasFollowUp = false, children }: ToolGroupProps) {
  const { t, isZh } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  // 流式期间输出是后到的：组内出现 diff 输出后要自动展开 ——
  // 改动内容不该被折叠藏起来（与单个工具格的 defaultOpen 语义一致）。
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const joined = toolNames.join(isZh ? ' 和 ' : ' and ');
  return (
    <div className={s.group} data-testid="tool-group" data-open={open || undefined}>
      <button
        type="button"
        className={s.groupHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={ChevronRight} size={12} className={s.caret} />
        <Icon icon={Terminal} size={13} className={s.groupIcon} />
        <span className={s.groupLabel}>{t('chat.toolGroup.summary', { tools: joined })}{hasFollowUp ? ` · ${t('chat.subagent.followUp')}` : ''}</span>
        <span className={s.groupCount}>{count}</span>
      </button>
      {open && (
        <div className={s.groupBody} data-testid="tool-group-body">
          {children}
        </div>
      )}
    </div>
  );
}

export interface ActivityEntryData {
  toolName?: string;
  argsSummary?: string;
  status?: 'running' | 'done' | 'error';
  /** 思考条目（与工具条目互斥）。 */
  thinking?: boolean;
  thinkingLabel?: string;
}

export interface ActivityGroupProps {
  /** 条目元数据 —— 组头摘要（N 命令 / N 思考）与运行态判定。 */
  entries: ActivityEntryData[];
  /** 组内完整单元（ToolCell / ThinkingCollapsible）。 */
  children: ReactNode;
}

/**
 * 活动聚合组 —— 工具调用与思考块混合折叠（对话式 agent 活动流）。
 *
 * 思考不再打断工具段：一组之内「已执行 xxx / 思考 n 秒」紧凑行依次排布，
 * 默认整体折叠为一行摘要（执行 N 命令 / N 思考），点组头展开逐条活动；
 * 组内单行仍可各自展开看详情（ToolCell 自身折叠）。
 */
export function ActivityGroup({ entries, children }: ActivityGroupProps) {
  const { t, isZh } = useI18n();
  const [open, setOpen] = useState(false);
  const toolEntries = entries.filter((e) => !e.thinking);
  const toolCount = toolEntries.length;
  const thinkingCount = entries.length - toolCount;
  const running = entries.some((e) => e.status === 'running');
  // 组头带上去重的工具名 —— 折叠态也能看到「动过什么」（思考并入工具
  // 组后，单工具不再有独立行，名字不能只留在展开层）。
  const names: string[] = [];
  for (const entry of toolEntries) {
    const name = entry.toolName ?? '';
    if (name && !names.includes(name)) names.push(name);
  }
  const namesLabel = names.join(isZh ? '、' : ', ');
  const hasFollowUp = toolEntries.some((entry) => {
    const args = parseArgs(entry.argsSummary ?? '');
    return entry.toolName?.startsWith('call_') && typeof args?.session_id === 'string' && args.session_id.length > 0;
  });
  // 组头文案:执行 N 命令(± 思考 M 次,带工具名);纯思考段「思考 M 次」。
  const label = toolCount > 0
    ? (names.length === 1
      ? (thinkingCount > 0
        ? t('chat.activityGroup.mixedNamed', { tools: toolCount, name: names[0], thinking: thinkingCount })
        : t('chat.activityGroup.toolsNamed', { count: toolCount, name: names[0] }))
      : (thinkingCount > 0
        ? t('chat.activityGroup.mixedList', { tools: toolCount, names: namesLabel, thinking: thinkingCount })
        : t('chat.activityGroup.toolsList', { count: toolCount, names: namesLabel })))
    : t('chat.activityGroup.thinking', { count: thinkingCount });
  return (
    <div className={s.group} data-testid="activity-group" data-open={open || undefined} data-running={running || undefined}>
      <button
        type="button"
        className={s.groupHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={ChevronRight} size={12} className={s.caret} />
        <Icon icon={Terminal} size={13} className={s.groupIcon} />
        <span className={s.groupLabel}>{running ? t('chat.activityGroup.running', { label }) : label}{hasFollowUp ? ` · ${t('chat.subagent.followUp')}` : ''}</span>
        <span className={s.groupCount}>{entries.length}</span>
      </button>
      {open && (
        <div className={s.groupBody} data-testid="activity-group-body">
          {children}
        </div>
      )}
    </div>
  );
}
