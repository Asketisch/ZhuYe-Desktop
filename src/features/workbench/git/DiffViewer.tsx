/**
 * DiffViewer —— 简单的 unified diff 渲染 (B6)。
 *
 * 按行 split + 颜色标记:
 *   - `+` → 绿 (insertion)
 *   - `-` → 红 (deletion)
 *   - ` ` → 上下文
 *   - `@@` → hunk header
 *
 * 行内语法高亮:语言优先取 `path` prop,缺省时从 diff 头部
 * (`diff --git a/x b/x` 或 `--- a/x` / `+++ b/x`)解析;多文件 diff
 * 无法归属单一语言时不高亮。超大 diff(>2000 行)退回纯行级着色。
 */
import { useMemo } from 'react';
import { highlight, langFromPath } from '@/components/highlight';
import s from '@/render/workbench/git/DiffViewer.module.css';

export interface DiffViewerProps {
  diff: string;
  emptyMessage?: string;
  /** 文件路径(推断行内高亮语言;缺省时尝试从 diff 头部解析)。 */
  path?: string;
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNum?: number;
  newNum?: number;
}

/** 超过该行数不做行内高亮(同步 Prism 大 diff 会卡)。 */
const INLINE_HIGHLIGHT_MAX_LINES = 2000;

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

/**
 * 从 unified diff 文本解析单文件路径;多文件(多个 `diff --git` 头)
 * 返回 null —— 无法归属单一语言,不做行内高亮。
 */
function pathFromDiff(raw: string): string | null {
  const headers = raw.match(/^diff --git a\//gm);
  if (headers && headers.length > 1) return null;
  const git = raw.match(/^diff --git a\/(.+?) b\//m);
  if (git?.[1]) return git[1];
  const minus = raw.match(/^--- (?:a\/)?(.+)$/m);
  if (minus?.[1] && minus[1] !== '/dev/null') return minus[1];
  return null;
}

export function DiffViewer({ diff, emptyMessage = 'No changes.', path }: DiffViewerProps) {
  const lines = useMemo(() => {
    const classified = classify(diff);
    const langPath = path ?? pathFromDiff(diff);
    const lang = langPath ? langFromPath(langPath) : null;
    const highlightable = lang !== null && classified.length <= INLINE_HIGHLIGHT_MAX_LINES;
    return classified.map((l) => ({
      ...l,
      // 行首 +/-/空格前缀不参与高亮,只高亮正文。
      html:
        highlightable && (l.kind === 'add' || l.kind === 'del' || l.kind === 'context')
          ? highlight(l.text.slice(1), lang)
          : null,
    }));
  }, [diff, path]);
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
          <span className={s.text}>
            {l.html !== null ? (
              <>
                {l.text.slice(0, 1)}
                <span dangerouslySetInnerHTML={{ __html: l.html }} />
              </>
            ) : (
              l.text
            )}
          </span>
        </div>
      ))}
    </pre>
  );
}
