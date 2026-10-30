/**
 * unified diff 解析与 inverse-patch。
 *
 * agent 的 edit/write 工具以 `ContentBlock::Diff { unified_diff }` 上报
 * before→after 变更;本模块把它解析成 hunk 列表供 CodeMirror 装饰
 * (新增行绿色背景、删除行红色块),并支持 Cursor 式逐块拒绝——
 * 通过内容锚定的 inverse-apply 把 hunk 还原回原文。
 *
 * 全部为纯函数,不触碰 IPC。
 */

export interface DiffHunk {
  /** @@ -oldStart,oldLines +newStart,newLines @@ 中的旧文件起始行(1 基)。 */
  oldStart: number;
  /** 新文件起始行(1 基)。 */
  newStart: number;
  /** hunk 内被删除的行(原文件内容,不含 '-' 前缀)。 */
  removed: string[];
  /** hunk 内新增的行(新文件内容,不含 '+' 前缀)。 */
  added: string[];
  /** hunk 头部的上下文行(取自新文件,用于显示与锚定)。 */
  contextBefore: string[];
  contextAfter: string[];
  /** 按 diff 原始顺序排列的旧、新文件行。 */
  oldSequence: string[];
  newSequence: string[];
  /** 新文件序列中新增行的偏移，用于定位显示。 */
  addedOffsets: number[];
  oldNoNewline: boolean;
  newNoNewline: boolean;
}

/** 解析完整的 unified diff hunk，保留行顺序和文件末尾换行标记。 */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldCount = 0;
  let newCount = 0;
  let lastKind = '';
  let changed = false;
  let complete = false;

  const finish = () => {
    if (current && complete && changed) hunks.push(current);
    current = null;
  };
  for (const line of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      finish();
      oldCount = Number(header[2] ?? 1);
      newCount = Number(header[4] ?? 1);
      current = {
        oldStart: Number(header[1]), newStart: Number(header[3]),
        removed: [], added: [], contextBefore: [], contextAfter: [],
        oldSequence: [], newSequence: [], addedOffsets: [],
        oldNoNewline: false, newNoNewline: false,
      };
      changed = false;
      complete = oldCount === 0 && newCount === 0;
      lastKind = '';
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\ No newline at end of file')) {
      if (lastKind === '-' || lastKind === ' ') current.oldNoNewline = true;
      if (lastKind === '+' || lastKind === ' ') current.newNoNewline = true;
      continue;
    }
    if (complete) continue;
    const kind = line[0];
    if (kind !== ' ' && kind !== '+' && kind !== '-') {
      current = null;
      continue;
    }
    const value = line.slice(1);
    if (kind !== '+') current.oldSequence.push(value);
    if (kind !== '-') current.newSequence.push(value);
    if (kind === '-') { current.removed.push(value); changed = true; }
    else if (kind === '+') {
      current.addedOffsets.push(current.newSequence.length - 1);
      current.added.push(value);
      changed = true;
    } else if (changed) current.contextAfter.push(value);
    else current.contextBefore.push(value);
    lastKind = kind;
    if (current.oldSequence.length > oldCount || current.newSequence.length > newCount) {
      current = null;
      continue;
    }
    complete = current.oldSequence.length === oldCount && current.newSequence.length === newCount;
  }
  finish();
  return hunks;
}

/**
 * 在 `content` 中唯一锚定新文件行序列并替换为旧文件行序列。
 *
 * 用内容锚定而非行号——agent 连续多次编辑同一文件时,前序 hunk 的拒绝
 * 会使行号漂移;行首空白完全一致的锚点也可能歧义,故只要求序列唯一。
 * 找不到唯一锚点 → null(调用方提示用户手动处理)。
 */
export function applyInverseHunk(content: string, hunk: DiffHunk): string | null {
  const contentLines = splitKeepTrailing(content);

  const target = hunk.newSequence;
  const positions = findAll(contentLines, target);
  if (positions.length !== 1) return null;
  const start = positions[0];
  const end = start + target.length;
  const atEof = end === contentLines.length || (end === contentLines.length - 1 && contentLines[end] === '');
  if ((hunk.oldNoNewline || hunk.newNoNewline) && !atEof) return null;
  if (hunk.newNoNewline && content.endsWith('\n')) return null;
  const next = [...contentLines.slice(0, start), ...hunk.oldSequence, ...contentLines.slice(end)];
  if (hunk.oldNoNewline && next[next.length - 1] === '') next.pop();
  else if (hunk.newNoNewline && !hunk.oldNoNewline) next.push('');
  return next.join('\n');
}

/**
 * 反转全部 hunk(Reject All):按顺序逐个应用;任一块锚定失败 → null,
 * 保证不落盘半恢复状态。
 */
export function applyInverseAll(content: string, hunks: DiffHunk[]): string | null {
  let current = content;
  for (const hunk of [...hunks].reverse()) {
    const next = applyInverseHunk(current, hunk);
    if (next === null) return null;
    current = next;
  }
  return current;
}

/** 按行拆分;保留结尾换行语义(以末尾是否空元素近似)。 */
function splitKeepTrailing(content: string): string[] {
  if (content === '') return [''];
  const lines = content.split('\n');
  return lines;
}

/** 在行数组中查找 target 序列的所有起始下标。 */
function findAll(haystack: string[], target: string[]): number[] {
  if (target.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i + target.length <= haystack.length; i++) {
    let matched = true;
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) {
        matched = false;
        break;
      }
    }
    if (matched) out.push(i);
  }
  return out;
}

/** hunk 是否为纯新增(删除行为空,拒绝 = 直接删除这些行)。 */
export function isPureAddition(hunk: DiffHunk): boolean {
  return hunk.removed.length === 0;
}

/**
 * 在当前内容里定位 hunk 的新增行区间(供编辑器装饰)。
 * 返回 [addedStartLine, addedEndLineExcl) 的 0 基行号;纯删除 hunk 返回
 * 插入点(单行);锚定失败返回 null。与 applyInverseHunk 同样内容锚定。
 */
export function locateHunk(
  content: string,
  hunk: DiffHunk,
): { addedStart: number; addedEnd: number } | null {
  const positions = findAll(content.split('\n'), hunk.newSequence);
  if (positions.length !== 1) return null;
  const start = positions[0];
  if (hunk.addedOffsets.length === 0) {
    const at = start + hunk.contextBefore.length;
    return { addedStart: at, addedEnd: at };
  }
  return {
    addedStart: start + hunk.addedOffsets[0],
    addedEnd: start + hunk.addedOffsets[hunk.addedOffsets.length - 1] + 1,
  };
}
