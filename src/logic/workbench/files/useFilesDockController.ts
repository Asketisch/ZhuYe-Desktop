/**
 * useFilesDockController —— 右 dock「文件」面板的状态与动作。
 *
 * 职责：
 * - 经 `useCurrentWorkspace` 拿当前工作区；`zhuye_list_dir(path, 1)` 逐目录懒加载
 *   （根目录随工作区查询，子目录在展开时才拉取，全部走 react-query 缓存）。
 * - `zhuye_git_status` 归一成文件级标记（modified / added / untracked），驱动树上的
 *   `.st` 徽标与「全部 / 已修改 / 未跟踪」过滤器；git 不可用（非 repo / 查询失败）时隐藏过滤器。
 * - `zhuye_read_file` 读取选中文件并构造预览模型（二进制 / 截断 / 错误均给已翻译提示，
 *   正文展示上限约 200KB）。
 *
 * 分层约定：视图（render 层）只接收已翻译的标签与纯数据，所有 t() 都在本 hook 内完成；
 * render 层持有 DockTreeNode / FilesDockPreview 的同构镜像声明（不反依赖逻辑层）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zhuye_git_status,
  zhuye_list_dir,
  zhuye_read_file,
  type ZhuyeDirEntry,
} from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/logic/harness/shell/useCurrentWorkspace';
import { escapeHtml, highlight, langFromPath } from '@/components/highlight';

/** 过滤器档位。 */
export type FilesDockFilter = 'all' | 'modified' | 'untracked';

/** git 状态归一：modified = 工作区改动；added = 已暂存新增；untracked = 未跟踪。 */
export type DockGitState = 'modified' | 'added' | 'untracked';

/** 树节点（逻辑层持有真实形状；render 层有同构镜像声明）。 */
export interface DockTreeNode {
  path: string;
  name: string;
  /** 后端原样返回："file" | "dir" | "symlink"。 */
  kind: string;
  /** 是否处于展开状态（仅目录有意义；用于 `.open` 旋转箭头）。 */
  expanded: boolean;
  gitState: DockGitState | null;
  /** 展示类名：modified → `.st.mod`，added / untracked → `.st.add`。 */
  gitMark: 'mod' | 'add' | null;
  /** 徽标字母：M / A / U。 */
  gitLetter: string | null;
  children: DockTreeNode[];
}

/** 预览模型：empty = 未选择；loading / error / binary 均携带已翻译提示文案。
 *  ready 携带按扩展名推断语言后的高亮 HTML（超大文件 / 未注册语言为转义纯文本）。 */
export type FilesDockPreview =
  | { kind: 'empty'; hint: string }
  | { kind: 'loading'; path: string; badge: string; label: string }
  | { kind: 'error'; path: string; badge: string; label: string }
  | { kind: 'binary'; path: string; badge: string; label: string }
  | {
      kind: 'ready';
      path: string;
      badge: string;
      /** Prism 语言 id（未注册语法为 null）。 */
      lang: string | null;
      /** 转义或 Prism 高亮后的正文 HTML（dangerouslySetInnerHTML 直接消费）。 */
      codeHtml: string;
      notice: string | null;
    };

/** dock 内统一的查询键前缀，refresh 只失效这一族。 */
const DOCK_KEY = 'files-dock';
/** 预览正文展示上限（字符数，约 200KB），超出截断并提示。 */
const PREVIEW_CHAR_CAP = 200_000;
/** 同步语法高亮上限（字符数）：超过则退回转义纯文本，避免打开预览卡顿。 */
const HIGHLIGHT_CHAR_CAP = 100_000;
/** 目录列表缓存 10s（dock 场景允许手动刷新兜底）。 */
const LIST_STALE_MS = 10_000;
/** 文件内容缓存 30s。 */
const FILE_STALE_MS = 30_000;

export function useFilesDockController() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { currentWorkspace: workspace } = useCurrentWorkspace();

  // ====== 目录懒加载：根目录 + 已展开的子目录，各一个 react-query 条目 ======
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const dirSpecs = useMemo(() => {
    // 根目录固定排第一，供下方 rootResult 按下标取用。
    const dirs: string[] = [];
    if (workspace) dirs.push(workspace);
    for (const dir of expanded) {
      if (dir !== workspace) dirs.push(dir);
    }
    return dirs.map((dir) => ({
      queryKey: [DOCK_KEY, 'dir', dir],
      queryFn: () => zhuye_list_dir(dir, 1),
      staleTime: LIST_STALE_MS,
      gcTime: 5 * 60_000,
    }));
  }, [workspace, expanded]);
  const dirResults = useQueries({ queries: dirSpecs });

  // 根目录结果固定在 specs[0]（workspace 永远排第一）。
  const rootResult = workspace ? dirResults[0] : undefined;
  const rootPending = !!rootResult?.isPending;
  const rootError = rootResult?.error
    ? (rootResult.error instanceof Error ? rootResult.error.message : String(rootResult.error))
    : null;

  // listing.root → 直接子条目；同时统计已加载条目数（副标题的 {count}）。
  const listings = new Map<string, ZhuyeDirEntry[]>();
  let loadedCount = 0;
  for (const result of dirResults) {
    const data = result.data;
    if (!data) continue;
    loadedCount += data.entries.length;
    if (!listings.has(data.root)) listings.set(data.root, data.entries);
  }

  // ====== git 状态：路径 → 归一标记 ======
  const gitQuery = useQuery({
    queryKey: [DOCK_KEY, 'git'],
    queryFn: zhuye_git_status,
    staleTime: LIST_STALE_MS,
    retry: false,
  });

  const gitMarks = useMemo(() => {
    const marks = new Map<string, DockGitState>();
    const data = gitQuery.data;
    if (!data?.is_repo) return marks;
    for (const entry of data.entries) {
      let state: DockGitState;
      if (entry.status === '??') state = 'untracked';
      else if (entry.status.includes('M')) state = 'modified';
      else if (entry.status.includes('A')) state = 'added';
      else continue; // D / R 等不在本面板标记
      marks.set(resolveGitPath(workspace, entry.path), state);
    }
    return marks;
  }, [gitQuery.data, workspace]);

  // git 不可用（非 repo 或查询失败）→ 隐藏过滤器行。
  const filtersVisible = gitQuery.isSuccess && !!gitQuery.data?.is_repo;

  // ====== 过滤器 + 按需展开 ======
  const [filter, setFilter] = useState<FilesDockFilter>('all');

  // 过滤器激活时，自动展开目标文件所在的目录链（按 git 状态推导，避免全库爬取）。
  const targetDirs = useMemo(() => {
    if (filter === 'all' || !workspace) return [] as string[];
    const dirs = new Set<string>();
    for (const [abs, state] of gitMarks) {
      const hit = filter === 'modified' ? state === 'modified' : state === 'untracked';
      if (!hit) continue;
      for (const dir of ancestorDirs(abs, workspace)) dirs.add(dir);
    }
    return [...dirs];
  }, [filter, gitMarks, workspace]);

  useEffect(() => {
    if (targetDirs.length === 0) return;
    const missing = targetDirs.filter((dir) => !expandedRef.current.has(dir));
    if (missing.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of missing) next.add(dir);
      return next;
    });
  }, [targetDirs]);

  // ====== 选中文件 + 预览 ======
  const [selected, setSelected] = useState<string | null>(null);
  const fileQuery = useQuery({
    queryKey: [DOCK_KEY, 'file', selected],
    queryFn: () => zhuye_read_file(selected as string),
    enabled: !!selected,
    staleTime: FILE_STALE_MS,
    retry: false,
  });

  // 每次渲染直接重建树（dock 规模小，无需 memo；listings 本就随查询结果逐帧变化）。
  // 根层的 key 是 workspace：zhuye_list_dir 返回的 listing.root 即请求的工作区路径。
  const buildLevel = (dirPath: string): DockTreeNode[] => {
    const wanted: DockGitState | null =
      filter === 'all' ? null : filter === 'modified' ? 'modified' : 'untracked';
    const entries = listings.get(dirPath) ?? [];
    const nodes = entries.map<DockTreeNode>((entry) => {
      const gitState = gitMarks.get(entry.path) ?? null;
      const isOpen = entry.kind === 'dir' && expanded.has(entry.path);
      return {
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        expanded: isOpen,
        gitState,
        gitMark: gitMarkOf(gitState),
        gitLetter: gitLetterOf(gitState),
        children: isOpen ? buildLevel(entry.path) : [],
      };
    });
    nodes.sort(dirsFirst);
    if (!wanted) return nodes;
    // 过滤档：文件按 git 状态收窄；目录保留「还有匹配后代」或「尚未加载」的
    // （未加载目录可能藏着匹配文件，交给 targetDirs 的自动展开补齐）。
    return nodes.filter((node) =>
      node.kind === 'dir'
        ? node.children.length > 0 || !listings.has(node.path)
        : node.gitState === wanted,
    );
  };
  const tree = workspace ? buildLevel(workspace) : [];

  const treeHint = !workspace
    ? t('harness.files.noWorkspace')
    : rootPending
      ? t('harness.files.loading')
      : rootError
        ? t('harness.files.treeError', { message: rootError })
        : tree.length === 0
          ? (filter === 'all' ? t('harness.files.treeEmpty') : t('harness.files.filterEmpty'))
          : null;

  const preview = useMemo<FilesDockPreview>(() => {
    if (!selected) return { kind: 'empty', hint: t('harness.files.noSelection') };
    const badge = langBadge(selected);
    const path = relPath(selected, workspace);
    if (fileQuery.isPending) {
      return { kind: 'loading', path, badge, label: t('harness.files.loading') };
    }
    if (fileQuery.error) {
      const message = fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error);
      return { kind: 'error', path, badge, label: t('harness.files.previewError', { message }) };
    }
    const data = fileQuery.data;
    if (!data) return { kind: 'loading', path, badge, label: t('harness.files.loading') };
    if (data.binary) return { kind: 'binary', path, badge, label: t('harness.files.binary') };
    let text = data.content;
    let notice: string | null = null;
    // 前端展示上限 + 后端 1MiB 截断统一给一条提示。
    if (text.length > PREVIEW_CHAR_CAP || data.truncated) {
      text = text.slice(0, PREVIEW_CHAR_CAP);
      notice = t('harness.files.truncated');
    }
    // 语法高亮:按扩展名推断语言;超大正文(同步高亮会卡)或语言未注册时
    // 退回转义纯文本(语言徽标仍显示扩展名,与正文渲染解耦)。
    const lang = langFromPath(selected);
    const codeHtml =
      lang && text.length <= HIGHLIGHT_CHAR_CAP
        ? (highlight(text, lang) ?? escapeHtml(text))
        : escapeHtml(text);
    return { kind: 'ready', path, badge, lang, codeHtml, notice };
  }, [selected, fileQuery.isPending, fileQuery.error, fileQuery.data, workspace, t]);
  // ====== 顶栏与动作 ======
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const workspaceName = workspace ? basename(workspace) : '—';
  const subtitle = t('harness.files.subtitle', { count: loadedCount, name: workspaceName });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [DOCK_KEY] });
  }, [queryClient]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleTree = useCallback(() => setTreeCollapsed((v) => !v), []);

  const filters = filtersVisible
    ? [
        { id: 'all' as const, label: t('harness.files.filterAll') },
        { id: 'modified' as const, label: t('harness.files.filterModified') },
        { id: 'untracked' as const, label: t('harness.files.filterUntracked') },
      ]
    : null;

  return {
    title: t('harness.files.title'),
    subtitle,
    refreshLabel: t('harness.files.refresh'),
    toggleLabel: treeCollapsed ? t('harness.files.expand') : t('harness.files.collapse'),
    treeCollapsed,
    treeHint,
    tree,
    filters,
    filter,
    selectedPath: selected,
    preview,
    selectFile: setSelected,
    toggleDir,
    toggleTree,
    refresh,
    setFilter,
  };
}

// ====== 纯函数助手 ======

/** 排序：目录优先，同级按名称。 */
function dirsFirst(a: DockTreeNode, b: DockTreeNode): number {
  const aDir = a.kind === 'dir' ? 0 : 1;
  const bDir = b.kind === 'dir' ? 0 : 1;
  if (aDir !== bDir) return aDir - bDir;
  return a.name.localeCompare(b.name);
}

/** 归一 git 状态 → `.st` 类名。 */
function gitMarkOf(state: DockGitState | null): 'mod' | 'add' | null {
  if (!state) return null;
  return state === 'modified' ? 'mod' : 'add';
}

/** 归一 git 状态 → 徽标字母（M = 改动，A = 暂存新增，U = 未跟踪）。 */
function gitLetterOf(state: DockGitState | null): string | null {
  if (!state) return null;
  if (state === 'modified') return 'M';
  if (state === 'added') return 'A';
  return 'U';
}

function basename(p: string): string {
  // Windows 用 '\'、Unix 用 '/'，两种分隔符都取最右一段。
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? p : p.slice(i + 1);
}

function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(p);
}

/** git status 的仓库相对路径 → 绝对路径（porcelain 对目录可能带尾斜杠，原样保留）。 */
function resolveGitPath(workspace: string | null, rel: string): string {
  if (isAbsolutePath(rel)) return rel;
  if (!workspace) return rel;
  return `${workspace.replace(/[\\/]+$/, '')}/${rel}`;
}

/**
 * 文件绝对路径 → 从 workspace 到它的全部目录前缀（自动展开用）。
 * git 条目是目录（尾斜杠）时含其自身；是文件时只取到父目录为止。
 */
function ancestorDirs(abs: string, workspace: string): string[] {
  const base = workspace.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const norm = abs.replace(/\\/g, '/');
  if (!norm.startsWith(`${base}/`)) return [];
  const tail = norm.slice(base.length + 1).replace(/\/+$/, '');
  if (!tail) return [];
  const isDirEntry = /\/$/.test(norm.slice(base.length + 1));
  const segments = tail.split('/').filter(Boolean);
  const usable = isDirEntry ? segments : segments.slice(0, -1);
  const dirs: string[] = [];
  let acc = base;
  for (const segment of usable) {
    acc = `${acc}/${segment}`;
    dirs.push(acc);
  }
  return dirs;
}

/** 绝对路径 → 相对工作区的展示路径（不在工作区内则原样返回）。 */
function relPath(p: string, workspace: string | null): string {
  if (!workspace) return p;
  const base = workspace.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith(`${base}/`)) return norm.slice(base.length + 1);
  return p;
}

/** 扩展名 → 预览徽标语言标签（大写、最长 4 字符；无扩展名按 TXT）。 */
function langBadge(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'TXT';
  const ext = name.slice(dot + 1).toUpperCase();
  return ext ? ext.slice(0, 4) : 'TXT';
}
