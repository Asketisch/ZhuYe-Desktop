/**
 * FileTree —— 折叠式目录树（B9-01）。
 *
 * 后端以前序遍历的扁平列表返回条目（带 `depth`）。
 * 我们按父路径分组，渲染为可折叠列表。
 */
import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FileCode2, File } from 'lucide-react';
import { Icon } from '@/features/design-system';
import type { ReflectDirEntry } from '@/utils/commands';
import s from './FileTree.module.css';

const TEXT_EXTS = new Set([
  'md', 'txt', 'json', 'toml', 'yaml', 'yml', 'ini', 'env', 'log',
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'kt', 'php',
  'sh', 'bash', 'zsh', 'html', 'css', 'scss', 'sass', 'less', 'xml', 'svg',
  'sql', 'graphql', 'prisma', 'lua', 'pl', 'r', 'dart',
]);
const CODE_EXTS = new Set(['rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'php', 'rb']);

function iconForEntry(entry: ReflectDirEntry) {
  if (entry.kind === 'dir') return Folder;
  const ext = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : '';
  if (CODE_EXTS.has(ext)) return FileCode2;
  if (TEXT_EXTS.has(ext)) return FileText;
  return File;
}

export interface FileTreeProps {
  entries: ReflectDirEntry[];
  /** 当前选中的文件路径。 */
  selectedPath?: string | null;
  /** 用户点击文件条目时回调。 */
  onSelectFile?: (path: string) => void;
  /** 用户点击目录条目时回调。 */
  onSelectDir?: (path: string) => void;
}

interface TreeNode {
  entry: ReflectDirEntry;
  children: TreeNode[];
}

/** 由扁平条目列表构建树（每个条目的 path 即其完整路径）。 */
function buildTree(entries: ReflectDirEntry[]): TreeNode[] {
  // 按父目录路径分组。
  const childrenByDir = new Map<string, ReflectDirEntry[]>();
  for (const e of entries) {
    const parent = parentDir(e.path);
    const list = childrenByDir.get(parent);
    if (list) {
      list.push(e);
    } else {
      childrenByDir.set(parent, [e]);
    }
  }
  // 树的根节点是父目录与根路径匹配的条目。
  const root = entries.length > 0 ? parentDir(entries[0].path) : null;
  function build(parentPath: string): TreeNode[] {
    const kids = childrenByDir.get(parentPath) ?? [];
    return kids
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        entry: e,
        children: e.kind === 'dir' ? build(e.path) : [],
      }));
  }
  return root ? build(root) : [];
}

function parentDir(p: string): string {
  // Windows 后端路径是 '\' 分隔,Unix 是 '/';两种都取最右的,
  // 否则 Windows 上整棵树会退化成平铺(所有条目的父目录都算成 '/')。
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i <= 0) return '/';
  return p.slice(0, i);
}

function basename(p: string): string {
  // 同上:分隔符两种都认,否则 Windows 上 testid 会带上整条路径,
  // e2e 的 file-row-<name> 选择器永远匹配不到。
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return p;
  return p.slice(i + 1);
}

export function FileTree({ entries, selectedPath, onSelectFile, onSelectDir }: FileTreeProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  // 跟踪每个路径的展开状态；目录仅在深度 0 时默认打开，以保持视图紧凑。
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const e of entries) {
      if (e.kind === 'dir' && e.depth === 0) init[e.path] = true;
    }
    return init;
  });

  if (tree.length === 0) {
    return (
      <div className={s.empty} data-testid="file-tree-empty">
        Empty directory
      </div>
    );
  }

  return (
    <ul className={s.tree} role="tree" data-testid="file-tree">
      {tree.map((node) => (
        <TreeRow
          key={node.entry.path}
          node={node}
          open={open}
          setOpen={setOpen}
          selectedPath={selectedPath ?? null}
          onSelectFile={onSelectFile}
          onSelectDir={onSelectDir}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: TreeNode;
  open: Record<string, boolean>;
  setOpen: (next: Record<string, boolean>) => void;
  selectedPath: string | null;
  onSelectFile?: (path: string) => void;
  onSelectDir?: (path: string) => void;
}

function TreeRow({ node, open, setOpen, selectedPath, onSelectFile, onSelectDir }: TreeRowProps) {
  const isDir = node.entry.kind === 'dir';
  const isOpen = !!open[node.entry.path];
  const isSelected = node.entry.path === selectedPath;
  const EntryIcon = iconForEntry(node.entry);

  const toggle = () => {
    if (isDir) {
      setOpen({ ...open, [node.entry.path]: !isOpen });
      onSelectDir?.(node.entry.path);
    } else {
      onSelectFile?.(node.entry.path);
    }
  };

  return (
    <li role="treeitem" aria-expanded={isDir ? isOpen : undefined}>
      <button
        type="button"
        className={s.row}
        data-kind={node.entry.kind}
        data-selected={isSelected || undefined}
        onClick={toggle}
        title={node.entry.path}
        data-testid={`file-row-${basename(node.entry.path)}`}
      >
        {isDir ? (
          <Icon icon={isOpen ? ChevronDown : ChevronRight} size={11} className={s.caret} />
        ) : (
          <span className={s.caretSpacer} />
        )}
        <Icon
          icon={isDir ? (isOpen ? FolderOpen : Folder) : EntryIcon}
          size={12}
          className={isDir ? s.dirIcon : s.fileIcon}
        />
        <span className={s.name}>{node.entry.name}</span>
        {!isDir && node.entry.size > 0 && (
          <span className={s.size}>{formatSize(node.entry.size)}</span>
        )}
      </button>
      {isDir && isOpen && node.children.length > 0 && (
        <ul className={s.children} role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.entry.path}
              node={child}
              open={open}
              setOpen={setOpen}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onSelectDir={onSelectDir}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}