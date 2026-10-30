/**
 * CodeMirrorEditor —— CodeMirror 6 编辑器 + agent 变更装饰(Cursor 式)。
 *
 * 取代旧 prism 只读预览:支持直接编辑(语法高亮经 language-data 覆盖主流
 * 语言),并叠加 pending 变更装饰——新增行绿色行背景,被删除的行以红色
 * 块 widget 呈现在新增区域上方(见 Cursor review 视图),每块顶部挂
 * Accept / Reject 控件;Reject 经 inverse-patch 重建原文并由调用方落盘。
 *
 * 数据边界:组件不直接读 store/IPC——hunks 与回调由 FilesView 注入;
 * Accept/Reject 按钮通过 CustomEvent 从 CM widget 冒泡到 React 容器。
 */
import { useEffect, useRef } from 'react';
import { Annotation, EditorState, Compartment, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages as languageData } from '@codemirror/language-data';
import { locateHunk, type DiffHunk } from '../editor/diffHunks';
import s from './CodeMirrorEditor.module.css';

/** 外部内容版本变化时整体替换缓冲(Reject 落盘后同步)。 */
export interface CodeMirrorEditorProps {
  path: string;
  value: string;
  /** 外部内容版本号:Reject/重读后 +1,驱动缓冲整体替换。 */
  revision: number;
  /** pending 变更块(agent 编辑);空 = 无装饰。 */
  hunks: DiffHunk[];
  /** Accept 单块(保留内容,清标记)。 */
  onAcceptHunk: (index: number) => void;
  /** Reject 单块;返回恢复后的内容(组件用它刷新缓冲),null = 失败。 */
  onRejectHunk: (index: number, currentContent: string) => Promise<string | null>;
  /** 只读模式(二进制/截断回退场景)。 */
  readOnly?: boolean;
  /** 用户修改缓冲时通知调用方；外部内容同步不触发。 */
  onChange?: (value: string) => void;
  onSave?: () => void;
  /**
   * 可选:挂载后写入"读取当前编辑器缓冲"的函数,卸载时清空。
   * 调用方(FilesView 的 Reject All)借此以缓冲而非缓存内容做
   * inverse-patch,与单块 Reject 的内容源保持一致。
   */
  bufferRef?: { current: (() => string) | null };
}

const setHunksEffect = StateEffect.define<DiffHunk[]>();
const externalUpdate = Annotation.define<boolean>();

/** 单个 hunk 的悬浮控件:Accept / Reject + 被删除行的红色块。 */
class HunkWidget extends WidgetType {
  constructor(
    readonly hunkIndex: number,
    readonly removed: string[],
    readonly isEqual: boolean,
  ) {
    super();
  }

  eq(other: HunkWidget): boolean {
    return (
      other.hunkIndex === this.hunkIndex &&
      other.removed.join('\n') === this.removed.join('\n') &&
      other.isEqual === this.isEqual
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `cm-hunkWidget ${s.hunkWidget}`;

    const bar = document.createElement('div');
    bar.className = `cm-hunkBar ${s.hunkBar}`;
    const accept = document.createElement('button');
    accept.className = `cm-hunkBtn ${s.hunkAccept}`;
    accept.textContent = 'Accept';
    accept.addEventListener('mousedown', (e) => e.preventDefault());
    accept.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dom.dispatchEvent(new CustomEvent('cm-hunk-accept', { detail: this.hunkIndex, bubbles: true }));
    });
    const reject = document.createElement('button');
    reject.className = `cm-hunkBtn ${s.hunkReject}`;
    reject.textContent = 'Reject';
    reject.addEventListener('mousedown', (e) => e.preventDefault());
    reject.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dom.dispatchEvent(new CustomEvent('cm-hunk-reject', { detail: this.hunkIndex, bubbles: true }));
    });
    bar.append(accept, reject);
    wrap.append(bar);

    for (const line of this.removed) {
      const el = document.createElement('div');
      el.className = `cm-removedLine ${s.removedLine}`;
      el.textContent = line === '' ? ' ' : line;
      wrap.append(el);
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** pending hunks 字段:行装饰(绿色新增行)+ 块装饰(红色删除区+控件)。 */
const hunksField = StateField.define<{ lines: DecorationSet; widgets: DecorationSet }>({
  create: () => ({ lines: Decoration.none, widgets: Decoration.none }),
  update(value, tr) {
    let hunks: DiffHunk[] | null = null;
    for (const effect of tr.effects) {
      if (effect.is(setHunksEffect)) hunks = effect.value;
    }
    if (hunks !== null) {
      return buildDecorations(tr.state.doc.toString(), hunks);
    }
    return {
      lines: value.lines.map(tr.changes),
      widgets: value.widgets.map(tr.changes),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.lines),
    EditorView.decorations.from(field, (v) => v.widgets),
  ],
});

function buildDecorations(content: string, hunks: DiffHunk[]): {
  lines: DecorationSet;
  widgets: DecorationSet;
} {
  const lineBuilder = new RangeSetBuilder<Decoration>();
  const widgetBuilder = new RangeSetBuilder<Decoration>();
  const docLines = content.split('\n');
  const lineStart = (line: number): number =>
    docLines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0);

  type Marked = { from: number; deco: Decoration };
  const lines: Marked[] = [];
  const widgets: Marked[] = [];

  hunks.forEach((hunk, index) => {
    const located = locateHunk(content, hunk);
    if (!located) return;
    const firstOffset = hunk.addedOffsets[0] ?? 0;
    for (const offset of hunk.addedOffsets) {
      const line = located.addedStart + offset - firstOffset;
      if (line >= docLines.length) break;
      lines.push({ from: lineStart(line), deco: Decoration.line({ class: `cm-addedLine ${s.addedLine}` }) });
    }
    if (hunk.removed.length > 0) {
      const insertLine = Math.min(located.addedStart, Math.max(docLines.length - 1, 0));
      widgets.push({
        from: lineStart(insertLine),
        deco: Decoration.widget({ widget: new HunkWidget(index, hunk.removed, false), side: -1 }),
      });
    }
  });

  lines.sort((a, b) => a.from - b.from);
  widgets.sort((a, b) => a.from - b.from);
  for (const m of lines) lineBuilder.add(m.from, m.from, m.deco);
  for (const m of widgets) widgetBuilder.add(m.from, m.from, m.deco);

  return { lines: lineBuilder.finish(), widgets: widgetBuilder.finish() };
}

function languageForPath(path: string): LanguageDescription | null {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  return languageData.find((l) => l.extensions.some((e) => e.toLowerCase() === ext)) ?? null;
}

export function CodeMirrorEditor({
  path,
  value,
  revision,
  hunks,
  onAcceptHunk,
  onRejectHunk,
  readOnly = false,
  onChange,
  onSave,
  bufferRef,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const handlers = useRef({ onAcceptHunk, onRejectHunk, onChange, onSave });
  handlers.current = { onAcceptHunk, onRejectHunk, onChange, onSave };
  const pathRef = useRef(path);
  pathRef.current = path;

  // 暴露缓冲读取函数;卸载时归还 null。
  useEffect(() => {
    if (!bufferRef) return;
    bufferRef.current = () => viewRef.current?.state.doc.toString() ?? '';
    return () => {
      bufferRef.current = null;
    };
  }, [bufferRef]);

  // 创建视图(一次);path 变化时切换语言并替换内容。
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([{ key: 'Mod-s', run: () => { handlers.current.onSave?.(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          hunksField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalUpdate))) {
              handlers.current.onChange?.(update.state.doc.toString());
            }
          }),
          langCompartment.current.of([]),
          readOnlyCompartment.current.of([
            EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
          ]),
          EditorView.theme({
            '&': { fontSize: '13px', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' },
            '.cm-content': { fontFamily: 'var(--font-mono)', paddingBottom: '24px' },
            '.cm-gutters': {
              backgroundColor: 'var(--bg-sidebar, var(--bg-input))',
              color: 'var(--text-muted)',
              border: 'none',
            },
            '.cm-activeLine': { backgroundColor: 'transparent' },
          }),
        ],
      }),
    });
    viewRef.current = view;

    const onAccept = (e: Event) => {
      const index = (e as CustomEvent<number>).detail;
      handlers.current.onAcceptHunk(index);
    };
    const onReject = (e: Event) => {
      const index = (e as CustomEvent<number>).detail;
      const content = view.state.doc.toString();
      const actionPath = pathRef.current;
      void Promise.resolve(handlers.current.onRejectHunk(index, content)).then((next) => {
        if (viewRef.current === view && pathRef.current === actionPath &&
            view.state.doc.toString() === content && next !== null && next !== content) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, annotations: externalUpdate.of(true) });
        }
      });
    };
    view.dom.addEventListener('cm-hunk-accept', onAccept);
    view.dom.addEventListener('cm-hunk-reject', onReject);
    return () => {
      view.dom.removeEventListener('cm-hunk-accept', onAccept);
      view.dom.removeEventListener('cm-hunk-reject', onReject);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // path → 语言 + 内容替换。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const desc = languageForPath(path);
    // stale 守卫:快速切文件时旧 desc.load() 后 resolve 会把新文件的
    // 语言 reconfigure 成旧语言。
    let stale = false;
    if (desc) {
      void desc.load().then((support) => {
        if (stale || !viewRef.current) return;
        viewRef.current.dispatch({
          effects: langCompartment.current.reconfigure(support),
        });
      });
    } else {
      viewRef.current?.dispatch({ effects: langCompartment.current.reconfigure([]) });
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: externalUpdate.of(true) });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Reject 等外部内容版本变化 → 整体替换缓冲。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: externalUpdate.of(true) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // hunks 变化 → 重算装饰。
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHunksEffect.of(hunks) });
  }, [hunks]);

  // readOnly 切换。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return (
    <div className={s.root} data-testid="cm-editor">
      <div ref={hostRef} className={s.host} />
    </div>
  );
}
