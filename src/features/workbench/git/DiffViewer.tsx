/**
 * DiffViewer —— 简单的 unified diff 渲染 (B6)。
 *
 * 按行 split + 颜色标记:
 *   - `+` → 绿 (insertion)
 *   - `-` → 红 (deletion)
 *   - ` ` → 上下文
 *   - `@@` → hunk header
 */
import { useMemo } from 'react';
import s from '@/render/workbench/git/DiffViewer.module.css';

export interface DiffViewerProps {
  diff: string;
  emptyMessage?: string;
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNum?: number;
  newNum?: number;
}

const KIND_CLASS: Record<DiffLineKind, string> = {
  add: s.add,
  del: s.del,
  context: s.context,
  hunk: s.hunk,
  meta: s.meta,
};

function classify(raw: string): DiffLine[] {
  const lines = raw.split('\n');
  const out: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      oldNum = m ? Number(m[1]) : 0;
      newNum = m ? Number(m[2]) : 0;
      out.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      out.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line, newNum: newNum++ });
    } else if (line.startsWith('-')) {
      out.push({ kind: 'del', text: line, oldNum: oldNum++ });
    } else if (line.startsWith(' ')) {
      out.push({ kind: 'context', text: line, oldNum: oldNum++, newNum: newNum++ });
    } else if (line.length === 0) {
      // 跳过末尾换行符
    } else {
      out.push({ kind: 'meta', text: line });
    }
  }
  return out;
}

export function DiffViewer({ diff, emptyMessage = 'No changes.' }: DiffViewerProps) {
  const lines = useMemo(() => classify(diff), [diff]);
  if (lines.length === 0) {
    return <div className={s.empty}>{emptyMessage}</div>;
  }
  return (
    <pre className={s.diff} data-testid="diff-viewer">
      {lines.map((l, i) => (
        <div key={i} className={KIND_CLASS[l.kind]} data-kind={l.kind}>
          <span className={s.gutter}>
            {l.oldNum ?? ''}
            {'\t'}
            {l.newNum ?? ''}
          </span>
          <span className={s.text}>{l.text}</span>
        </div>
      ))}
    </pre>
  );
}
