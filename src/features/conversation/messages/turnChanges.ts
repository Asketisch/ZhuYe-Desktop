/**
 * turnChanges —— 从单个 turn 派生「本轮改动」清单（纯函数）。
 *
 * v1.13:改动卡从「全会话汇总一块、挂在消息流顶部」改为「每轮一张、
 * 挂在该轮末尾」(对齐 ZCode v4 的 `ConversationFileSummaryPanel`)。
 * 数据源不变:引擎 `edit`/`write` 工具的输出自带 `metadata.path` 与
 * `metadata.diff`,`TurnItem.tool_output` 已保留这两个字段(回放链
 * `stores/replay.ts` 同样提取)—— **无需新增后端命令**。
 *
 * 单独成文件的原因:`features/messages/ScmChanges.tsx` 已被删除,
 * 而这些派生逻辑需要被独立测试(纯函数,不依赖组件)。
 */
import type { Turn, TurnItem } from '@/stores/agent/types';

/** 写类工具名(改文件的才进改动卡)。与后端实际注册名逐字对齐
 * （zhuye-tools `Tool::name()`,大小写敏感）:
 * `write` / `edit` / `delete_file` / `notebook_edit` / `PlanWrite`。
 * `bash` 有意排除 —— 它改文件但不产出 path/diff 元数据,进卡也只是空行。
 */
const WRITE_TOOLS = new Set(['write', 'edit', 'delete_file', 'notebook_edit', 'PlanWrite']);

/** 从单条 turn 派生的一处文件改动。 */
export interface TurnChange {
  /** 工具输出的目标文件路径（`metadata.path`;缺失时回退到参数里的 path）。 */
  path: string;
  /** unified diff 正文（`metadata.diff` / ContentBlock::Diff;无则空串）。 */
  diff: string;
  /** 该改动是否来自失败的工具调用。 */
  isError: boolean;
  /** 产出该改动的工具名（展示用）。 */
  toolName: string;
}

/** 改动文件的行数统计（+ / −）。 */
export interface DiffStat {
  added: number;
  removed: number;
}

/**
 * 从 args JSON 里取 path 字段（工具未在 metadata 里给 path 时的兜底）。
 */
function argsPath(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { path?: unknown };
    return typeof parsed.path === 'string' && parsed.path ? parsed.path : null;
  } catch {
    return null;
  }
}

/**
 * 从单条 turn 派生文件改动清单（纯函数）。
 *
 * 配对规则:一条 `tool_output` 找同 `callId` 的 `tool_call` 判工具名 ——
 * 只有写类工具的输出才算改动。同一文件在同一轮内多次改动**只留一条**
 * （保留最后一次的 diff,反映该轮结束时的净结果）。
 */
export function deriveChangesFromTurn(turn: Turn): TurnChange[] {
  const out: TurnChange[] = [];
  const byPath = new Map<string, TurnChange>();
  for (const item of turn.items as TurnItem[]) {
    if (item.kind !== 'tool_output') continue;
    // 配对的 tool_call 判工具名。
    const call = turn.items.find(
      (i): i is Extract<TurnItem, { kind: 'tool_call' }> =>
        i.kind === 'tool_call' && i.callId === item.callId,
    );
    if (!call || !WRITE_TOOLS.has(call.toolName)) continue;
    const path = item.path || argsPath(call.argsSummary) || argsPath(call.argsStream);
    if (!path) continue;
    const change: TurnChange = {
      path,
      diff: item.diff ?? '',
      isError: item.isError,
      toolName: call.toolName,
    };
    const existing = byPath.get(path);
    if (existing) {
      // 同轮同文件多次改动:保留最后一条(净结果),但失败标记不丢。
      existing.diff = change.diff;
      existing.toolName = change.toolName;
      existing.isError = existing.isError || change.isError;
      continue;
    }
    byPath.set(path, change);
    out.push(change);
  }
  return out;
}

/**
 * 统计 unified diff 的增删行数（排除 `+++` / `---` 文件头）。
 *
 * 与 `logic/chat/gitSummary.ts::summarizeDiff` 同款口径,但只数单文件的
 * 增删（不数文件数 —— 文件数由调用方按清单长度给）。
 */
export function countDiffLines(diff: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

/**
 * 一轮改动的汇总（卡片头用）。
 */
export interface TurnChangesSummary {
  /** 改动文件数。 */
  files: number;
  /** 新增行数合计。 */
  added: number;
  /** 删除行数合计。 */
  removed: number;
}

/** 汇总一轮的改动统计。 */
export function summarizeTurnChanges(changes: TurnChange[]): TurnChangesSummary {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    const stat = countDiffLines(change.diff);
    added += stat.added;
    removed += stat.removed;
  }
  return { files: changes.length, added, removed };
}
