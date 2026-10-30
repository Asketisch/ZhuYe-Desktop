/**
 * editorStore —— agent 代码编辑的 pending 变更存储(Cursor 式 review)。
 *
 * 数据流：agent 的 edit/write 工具完成后,`tool_call_end` 事件携带
 * `ContentBlock::Diff`(before→after 的 unified diff)与目标 path。本 store
 * 自订阅 agentEventBus(与 agentStore 同款守卫),把每次编辑累计为该 path
 * 的 pending hunk 列表;FilesView 的 CodeMirror 编辑器据此渲染绿/红变更
 * 区域,并提供逐块 / 全部的 Accept / Reject:
 *  - Accept  → 保留当前内容,清除该块标记;
 *  - Reject  → 用 inverse-patch 重建原文(`diffHunks.applyInverse*`),
 *              经 `reflect_write_file` 落盘后清除标记。
 *
 * 与 agentStore 分离:编辑 review 状态独立于会话状态,切会话不丢
 * (文件在磁盘上的 pending 变更与会话无关)。
 */
import { create } from 'zustand';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { reflect_write_file } from '@/utils/commands';
import {
  applyInverseAll,
  applyInverseHunk,
  parseUnifiedDiff,
  type DiffHunk,
} from '@/features/editor/diffHunks';
import { summarizeToolOutput } from './agent/turns';

export interface PendingEdit {
  /** 该 path 上累计的 hunk(按 agent 编辑顺序)。 */
  hunks: DiffHunk[];
  /** 最近一次编辑时间(ms)。 */
  updatedAt: number;
}

export interface EditorState {
  /** 未保存的缓冲及其读取时的磁盘内容，跨视图保留。 */
  drafts: Record<string, { text: string; base: string }>;
  setDraft: (path: string, text: string, base: string, keepClean?: boolean) => void;
  markSaved: (path: string, content: string) => void;
  clearDraft: (path: string) => void;
  saving: Record<string, boolean>;
  beginSave: (path: string) => boolean;
  endSave: (path: string) => void;
  /** path → pending 变更。 */
  pending: Record<string, PendingEdit>;
  /** 最近被 agent 编辑的文件(FilesView 自动聚焦用)。 */
  lastEditedPath: string | null;
  /** Reject 落盘后的内容版本号(path → 自增),编辑器据此刷新缓冲。 */
  contentVersion: Record<string, number>;
  /** 是否已经挂上 agent event bus 订阅(防止 React 18 StrictMode 双 mount 重复挂)。 */
  subscribed: boolean;

  subscribe: () => () => void;
  /** 由 tool_call_end 事件驱动:累计该 path 的 pending hunk。 */
  recordEdit: (path: string, unifiedDiff: string) => void;
  /** Accept 单块:仅清除标记,内容保留。 */
  acceptHunk: (path: string, index: number) => void;
  /** Accept 全部。 */
  acceptAll: (path: string) => void;
  /**
   * Reject 单块:对 `currentContent`(编辑器当前缓冲)做 inverse-apply →
   * 写盘 → 清除该块。返回恢复后的内容;锚定失败返回 null(不落盘)。
   */
  rejectHunk: (
    path: string,
    index: number,
    currentContent: string,
  ) => Promise<string | null>;
  /** Reject 全部:任一块锚定失败则整体不落盘。 */
  rejectAll: (path: string, currentContent: string) => Promise<string | null>;
  /** 清除某 path 的全部 pending(编辑器关闭等场景,不做任何写盘)。 */
  clear: (path: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  drafts: {},
  setDraft: (path, text, base, keepClean = false) => {
    const drafts = { ...get().drafts };
    const previous = drafts[path];
    const original = previous?.base ?? base;
    if (text === original && !keepClean) delete drafts[path];
    else drafts[path] = { text, base: original };
    set({ drafts });
  },
  markSaved: (path, content) => {
    const drafts = { ...get().drafts };
    const current = drafts[path];
    if (current?.text === content) delete drafts[path];
    else if (current) drafts[path] = { ...current, base: content };
    set({ drafts });
  },
  clearDraft: (path) => {
    const drafts = { ...get().drafts };
    delete drafts[path];
    set({ drafts });
  },
  saving: {},
  beginSave: (path) => {
    if (get().saving[path]) return false;
    set({ saving: { ...get().saving, [path]: true } });
    return true;
  },
  endSave: (path) => {
    const saving = { ...get().saving };
    delete saving[path];
    set({ saving });
  },
  pending: {},
  lastEditedPath: null,
  contentVersion: {},
  subscribed: false,

  subscribe: () => {
    // 与 agentStore 同样,subscribe() 跨组件实例幂等(React StrictMode 安全)。
    // 第一个调用挂载真实订阅,后续调用直接返回 no-op 清理函数。
    if (get().subscribed) {
      return () => {};
    }
    set({ subscribed: true });
    const unsubscribe = subscribeAgentEvent((event) => {
      if (event.msg.type !== 'tool_call_end') return;
      const summary = extractDiffRef(event.msg.output);
      if (!summary) return;
      get().recordEdit(summary.path, summary.diff);
    });
    return () => {
      unsubscribe();
      // 必须重置标志:StrictMode / HMR 的 mount→cleanup→mount 序列中,
      // 若保留 true,第二次 mount 会短路成 no-op,订阅永久丢失(与
      // agentStore.store.ts 的 cleanup 语义保持一致)。
      set({ subscribed: false });
    };
  },

  recordEdit: (path, unifiedDiff) => {
    const hunks = parseUnifiedDiff(unifiedDiff);
    if (hunks.length === 0) return;
    const prev = get().pending[path];
    set({
      pending: {
        ...get().pending,
        [path]: {
          hunks: [...(prev?.hunks ?? []), ...hunks],
          updatedAt: Date.now(),
        },
      },
      lastEditedPath: path,
    });
  },

  acceptHunk: (path, index) => {
    const entry = get().pending[path];
    if (!entry) return;
    const hunks = entry.hunks.filter((_, i) => i !== index);
    setPending(set, get(), path, hunks);
  },

  acceptAll: (path) => {
    setPending(set, get(), path, []);
  },

  rejectHunk: async (path, index, currentContent) => {
    const entry = get().pending[path];
    const hunk = entry?.hunks[index];
    if (!hunk) return null;
    const restored = applyInverseHunk(currentContent, hunk);
    if (restored === null) return null;
    try {
      await reflect_write_file(path, restored);
    } catch {
      return null; // 写盘失败 → 不清标记,保留 pending 供重试
    }
    const hunks = (get().pending[path]?.hunks ?? []).filter((item) => item !== hunk);
    setPending(set, get(), path, hunks, true);
    return restored;
  },

  rejectAll: async (path, currentContent) => {
    const entry = get().pending[path];
    if (!entry) return null;
    const restored = applyInverseAll(currentContent, entry.hunks);
    if (restored === null) return null;
    try {
      await reflect_write_file(path, restored);
    } catch {
      return null;
    }
    const restoredHunks = new Set(entry.hunks);
    const hunks = (get().pending[path]?.hunks ?? []).filter((item) => !restoredHunks.has(item));
    setPending(set, get(), path, hunks, true);
    return restored;
  },

  clear: (path) => {
    setPending(set, get(), path, []);
  },
}));

function setPending(
  set: (partial: Partial<EditorState>) => void,
  get: EditorState,
  path: string,
  hunks: DiffHunk[],
  contentChanged = false,
): void {
  const pending = { ...get.pending };
  const version = { ...get.contentVersion };
  if (hunks.length === 0) {
    delete pending[path];
  } else {
    pending[path] = { hunks, updatedAt: Date.now() };
  }
  if (contentChanged) version[path] = (version[path] ?? 0) + 1;
  set({ pending, contentVersion: version });
}

/** 从 tool_call_end 的 output 里提取 (path, unified_diff) —— 复用
 * agent/turns 的 summarizeToolOutput(同一协议形态)。 */
function extractDiffRef(output: unknown): { path: string; diff: string } | null {
  const summary = summarizeToolOutput(output);
  return summary.diff && summary.path ? { path: summary.path, diff: summary.diff } : null;
}
