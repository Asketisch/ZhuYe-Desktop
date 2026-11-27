/**
 * FilesDockView —— 右 dock「文件」面板的纯展示层。
 *
 * 样式全部来自 harness.css 的 dock 契约类（.fdock / .fdock-bar / .fdock-tree /
 * .tree-row / .file-preview …），本层不持有样式、不访问逻辑层与宿主对象；
 * 所有文案由逻辑层翻译后经 props 传入。
 *
 * 注意：DockTreeNode / FilesDockPreview / FilesDockFilter 在逻辑层
 * （useFilesDockController）持有真实形状，此处为同构镜像声明。
 */
import { ChevronDown, ChevronRight, Folder, FileText, RefreshCw } from 'lucide-react';

/** 过滤器档位（与逻辑层 FilesDockFilter 同构）。 */
export type FilesDockFilter = 'all' | 'modified' | 'untracked';

/** 树节点（与逻辑层 DockTreeNode 同构）。 */
export interface DockTreeNode {
  path: string;
  name: string;
  kind: string;
  expanded: boolean;
  gitState: 'modified' | 'added' | 'untracked' | null;
  gitMark: 'mod' | 'add' | null;
  gitLetter: string | null;
  children: DockTreeNode[];
}

/** 预览模型（与逻辑层 FilesDockPreview 同构）：文案均已翻译。 */
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
      /** 转义或 Prism 高亮后的正文 HTML。 */
      codeHtml: string;
      notice: string | null;
    };

export interface FilesDockFilterOption {
  id: FilesDockFilter;
  label: string;
}

export interface FilesDockViewProps {
  title: string;
  subtitle: string;
  refreshLabel: string;
  toggleLabel: string;
  /** 目录树是否折叠（折叠后仅剩顶栏 + 过滤器 + 预览）。 */
  treeCollapsed: boolean;
  /** 目录树占位提示（无工作区 / 加载中 / 出错 / 空），null 表示正常渲染树。 */
  treeHint: string | null;
  nodes: DockTreeNode[];
  /** 过滤器选项；null = git 不可用，整行隐藏。 */
  filters: FilesDockFilterOption[] | null;
  activeFilter: FilesDockFilter;
  selectedPath: string | null;
  preview: FilesDockPreview;
  onToggleTree: () => void;
  onRefresh: () => void;
  onFilterChange: (id: FilesDockFilter) => void;
  /** 点击文件行 → 选中并加载预览。 */
  onOpenFile: (path: string) => void;
  /** 点击目录行 → 折叠 / 展开（展开时懒加载子目录）。 */
  onToggleDir: (path: string) => void;
}

export function FilesDockView(props: FilesDockViewProps) {
  return (
    <div className="fdock" data-testid="files-dock">
      <div className="fdock-bar">
        <button
          type="button"
          className="fdock-tgl"
          data-testid="files-dock-collapse"
          aria-label={props.toggleLabel}
          title={props.toggleLabel}
          onClick={props.onToggleTree}
        >
          {/* harness.css 的折叠旋转规则只作用于 .fdock-tree 内部的 .fdock-tgl，
              顶栏开关够不到，这里直接按状态切换箭头方向 */}
          {props.treeCollapsed
            ? <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
            : <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        <span className="fdock-t">{props.title}</span>
        <span className="fdock-sub">{props.subtitle}</span>
        <span className="tb-spacer" />
        <button
          type="button"
          className="tb-btn"
          data-testid="files-dock-refresh"
          aria-label={props.refreshLabel}
          title={props.refreshLabel}
          onClick={props.onRefresh}
        >
          <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div
        className={props.treeCollapsed ? 'fdock-tree collapsed' : 'fdock-tree'}
        data-testid="files-dock-tree"
      >
        <div className="tree">
          {props.treeHint ? (
            <div className="fdock-sub" style={{ padding: '6px 8px' }}>{props.treeHint}</div>
          ) : (
            props.nodes.map((node) => (
              <DockRow
                key={node.path}
                node={node}
                selectedPath={props.selectedPath}
                onOpenFile={props.onOpenFile}
                onToggleDir={props.onToggleDir}
              />
            ))
          )}
        </div>
      </div>

      {props.filters && (
        <div className="fdock-filters">
          <div className="seg">
            {props.filters.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === props.activeFilter ? 'on' : ''}
                data-testid={`files-dock-filter-${option.id}`}
                onClick={() => props.onFilterChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="file-preview" data-testid="files-dock-preview">
        {props.preview.kind === 'empty' ? (
          <div className="fdock-sub" style={{ padding: '14px 10px' }}>{props.preview.hint}</div>
        ) : (
          <>
            <div className="fp-head">
              <span className="fp-path">{props.preview.path}</span>
              <span className="fp-badge">{props.preview.badge}</span>
            </div>
            {props.preview.kind !== 'ready' && (
              <div className="fdock-sub" style={{ padding: '10px' }}>{props.preview.label}</div>
            )}
            {props.preview.kind === 'ready' && (
              <>
                {props.preview.notice && (
                  <div className="fdock-sub" style={{ padding: '8px 10px' }}>{props.preview.notice}</div>
                )}
                <pre
                  className="fp-code"
                  data-testid="files-dock-code"
                  dangerouslySetInnerHTML={{ __html: props.preview.codeHtml }}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface DockRowProps {
  node: DockTreeNode;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}

/** 单个树行（目录行递归渲染已加载的子层级）。 */
function DockRow({ node, selectedPath, onOpenFile, onToggleDir }: DockRowProps) {
  const isDir = node.kind === 'dir';
  const isOpen = isDir && node.expanded;
  const classes = [
    'tree-row',
    isDir ? 'dir' : 'file',
    isOpen ? 'open' : '',
    node.path === selectedPath ? 'sel' : '',
  ].filter(Boolean).join(' ');
  return (
    <>
      <button
        type="button"
        className={classes}
        data-testid={`${isDir ? 'files-dock-dir' : 'files-dock-file'}-${node.name}`}
        title={node.path}
        onClick={() => (isDir ? onToggleDir(node.path) : onOpenFile(node.path))}
      >
        {/* 目录行放旋转箭头（.tree-row.open .tw 负责 90° 旋转），文件行用空 tw 占位对齐 */}
        <span className="tw">
          {isDir && <ChevronRight size={10} strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <span className="ic">
          {isDir ? <Folder size={11} strokeWidth={1.75} aria-hidden="true" /> : <FileText size={11} strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <span className="tn">{node.name}</span>
        {node.gitMark && node.gitLetter && (
          <span className={`st ${node.gitMark}`}>{node.gitLetter}</span>
        )}
      </button>
      {isOpen && node.children.length > 0 && (
        <div className="tree-group">
          {node.children.map((child) => (
            <DockRow
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              onToggleDir={onToggleDir}
            />
          ))}
        </div>
      )}
    </>
  );
}
