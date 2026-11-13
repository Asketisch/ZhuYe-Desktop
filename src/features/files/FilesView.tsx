/**
 * Files —— 真实文件浏览器 (B9-01)。
 *
 * 左:FileTree,基于 `reflect_list_dir` 拉取的目录条目。
 * 右:CodeMirrorEditor(CM6,可编辑 + 语法高亮);agent 编辑过的文件叠加
 * Cursor 式变更装饰(绿/红 + 逐块 Accept/Reject),Reject 经
 * `editorStore.rejectHunk` inverse-patch 恢复原文并写回磁盘。
 * 顶:workspace 路径 + 刷新按钮。
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, RefreshCcw, ChevronRight, Check, Undo2, Zap, AlertTriangle } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Icon, Spinner, EmptyState, Badge, Button } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_agent_status,
  reflect_list_dir,
  reflect_read_file,
  reflect_lsp_set_enabled,
  reflect_lsp_status,
  reflect_lsp_warmup,
  reflect_lsp_diagnostics,
  type LspStatus,
} from '@/utils/commands';

/** 按工作区持久化 LSP 开关（默认关闭——多项目同时起语言服务会拖累系统）。 */
export function lspPrefKey(workspace: string | null): string {
  return `reflect.lsp.enabled.${workspace ?? 'none'}`;
}

export function readLspPref(workspace: string | null): boolean {
  try {
    return localStorage.getItem(lspPrefKey(workspace)) === 'on';
  } catch {
    return false;
  }
}

function writeLspPref(workspace: string | null, enabled: boolean): void {
  try {
    localStorage.setItem(lspPrefKey(workspace), enabled ? 'on' : 'off');
  } catch {
    // localStorage 不可用（隐私模式等）—— 仅本会话生效。
  }
}
import { useEditorStore } from '@/stores/editorStore';
import { useAgentStore } from '@/stores/agentStore';
import { FileTree } from './FileTree';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { useFileDraftController } from './useFileDraftController';
import s from './FilesView.module.css';

// 跨视图卸载仍串行化 LSP 命令，避免旧请求覆盖新视图的状态。
let lspQueue: Promise<void> = Promise.resolve();

export function FilesView() {
  const { t } = useI18n();
  const statusQ = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });
  const workspace = statusQ.data?.workspace ?? null;
  const treeQ = useQuery({
    queryKey: ['files-tree', workspace],
    queryFn: () => reflect_list_dir(workspace, 4),
    enabled: !!workspace,
    staleTime: 10_000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const fileQ = useQuery({
    queryKey: ['files-read', selected],
    queryFn: () => reflect_read_file(selected!),
    enabled: !!selected,
    staleTime: 60_000,
  });

  // LSP:按工作区手动开启(默认关);开启状态跨会话恢复。
  const [lsp, setLsp] = useState<LspStatus>({
    enabled: false,
    servers: [],
    diagnostics: { documents: 0, count: 0, statusLine: '' },
  });
  const [lspBusy, setLspBusy] = useState(false);
  const [lspError, setLspError] = useState<string | null>(null);
  const translateRef = useRef(t);
  translateRef.current = t;
  const lspGeneration = useRef(0);
  useEffect(() => {
    const generation = ++lspGeneration.current;
    if (!workspace) {
      setLspBusy(true);
      return () => { lspGeneration.current += 1; };
    }
    setLspBusy(true);
    setLspError(null);
    setLsp({ enabled: false, servers: [], diagnostics: { documents: 0, count: 0, statusLine: '' } });
    const pref = readLspPref(workspace);
    lspQueue = lspQueue.catch(() => {}).then(async () => {
      if (generation !== lspGeneration.current) return;
      try {
        let status = await reflect_lsp_status();
        if (generation !== lspGeneration.current) return;
        if (status.enabled !== pref) status = await reflect_lsp_set_enabled(pref);
        if (!status.enabled) useAgentStore.setState({ lspServers: [] });
        if (generation !== lspGeneration.current) return;
        setLsp(status);
        if (status.enabled !== pref) setLspError(translateRef.current('files.lspUnavailable'));
      } catch (error) {
        if (generation === lspGeneration.current) {
          setLspError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (generation === lspGeneration.current) setLspBusy(false);
      }
    });
    return () => { lspGeneration.current += 1; };
  }, [workspace]);

  const onToggleLsp = () => {
    if (!workspace || lspBusy) return;
    const generation = lspGeneration.current;
    const next = !lsp.enabled;
    setLspBusy(true);
    setLspError(null);
    lspQueue = lspQueue.catch(() => {}).then(async () => {
      if (generation !== lspGeneration.current) return;
      try {
        const status = await reflect_lsp_set_enabled(next);
        if (!status.enabled) useAgentStore.setState({ lspServers: [] });
        if (generation !== lspGeneration.current) return;
        setLsp(status);
        if (status.enabled === next) writeLspPref(workspace, next);
        else setLspError(t('files.lspUnavailable'));
      } catch (error) {
        if (generation === lspGeneration.current) {
          setLspError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (generation === lspGeneration.current) setLspBusy(false);
      }
    });
  };

  // 文件预热:真正打开代码文件后才触发 didOpen(VSCode 式按需索引);
  // LSP 未开启时不调用。
  useEffect(() => {
    if (lspBusy || !lsp.enabled || !fileQ.data || fileQ.data.binary || !selected) return;
    void reflect_lsp_warmup(fileQ.data.path).catch(() => {/* 尽力而为 */});
  }, [lspBusy, lsp.enabled, fileQ.data, selected]);

  // 当前文件的 LSP 诊断(编译器 / 检查器反馈)。诊断由 server 推送后
  // 被动缓存 —— 预热后才有内容,故随文件打开后短暂轮询几次。
  const diagQ = useQuery({
    queryKey: ['lsp-diagnostics', selected],
    queryFn: () => reflect_lsp_diagnostics(selected as string),
    enabled: !!selected && lsp.enabled && !lspBusy,
    staleTime: 5_000,
    refetchInterval: lsp.enabled && !lspBusy ? 15_000 : false,
  });
  const diagnostics = diagQ.data ?? [];

  const pending = useEditorStore((st) => (selected ? st.pending[selected] : undefined));
  const lastEditedPath = useEditorStore((st) => st.lastEditedPath);
  const acceptHunk = useEditorStore((st) => st.acceptHunk);
  const acceptAll = useEditorStore((st) => st.acceptAll);
  const rejectHunk = useEditorStore((st) => st.rejectHunk);
  const rejectAll = useEditorStore((st) => st.rejectAll);
  const { actionError, rejectingPath, resetVersion, draft, saving, onSave, onReload, runReject, onChange } =
    useFileDraftController(selected, fileQ.data);

  // agent 刚编辑过某文件 → 自动聚焦到该文件(编辑器打开即可 review)。
  useEffect(() => {
    if (lastEditedPath) setSelected(lastEditedPath);
  }, [lastEditedPath]);

  const onAcceptHunk = (index: number) => {
    if (!selected) return;
    acceptHunk(selected, index);
  };

  const onAcceptAll = () => {
    if (!selected) return;
    acceptAll(selected);
  };

  const onRejectHunk = (index: number, currentContent: string): Promise<string | null> =>
    selected ? runReject(() => rejectHunk(selected, index, currentContent)) : Promise.resolve(null);

  const onRejectAll = (currentContent: string): Promise<string | null> =>
    selected ? runReject(() => rejectAll(selected, currentContent)) : Promise.resolve(null);

  const path = fileQ.data?.path ?? selected ?? '';
  const hunks = pending?.hunks ?? [];
  const readOnly = !!fileQ.data?.truncated || rejectingPath === selected;
  // editorStore 的内容版本号:Reject 落盘后 setPending 会 +1,据此驱动
  // CodeMirrorEditor 整体替换缓冲(此前硬编码 0,该机制从未生效,
  // Reject All 后编辑器仍显示恢复前内容,与磁盘不一致)。
  const contentVersion = useEditorStore((st) => (selected ? st.contentVersion[selected] : undefined));
  // 编辑器缓冲读取器:Reject All 与单块 Reject 同源 —— 用缓冲而非
  // 查询缓存做 inverse-patch(用户有未保存修改时,用缓存会写错内容)。
  const bufferRef = useRef<(() => string) | null>(null);

  return (
    <PageShell
      icon={FolderOpen}
      title={t('files.title')}
      subtitle={t('files.subtitle')}
      width="lg"
    >
      <div className={s.pathBar}>
        <Icon icon={FolderOpen} size={14} />
        <code className={s.workspacePath} data-testid="files-workspace-path">
          {workspace ?? t('common.loading')}
        </code>
        <button
          type="button"
          className={s.refresh}
          onClick={() => treeQ.refetch()}
          aria-label={t('files.refresh')}
          data-testid="files-refresh"
        >
          <Icon icon={RefreshCcw} size={12} /> {t('files.refresh')}
        </button>
        <button
          type="button"
          className={s.lspChip}
          data-enabled={lsp.enabled || undefined}
          onClick={onToggleLsp}
          disabled={lspBusy || !workspace}
          data-testid="files-lsp-toggle"
          title={lsp.enabled ? t('files.lspOnHint') : t('files.lspOffHint')}
        >
          <Icon icon={Zap} size={12} />
          {lsp.enabled
            ? t('files.lspOn', { count: String(lsp.servers.length) })
            : t('files.lspOff')}
        </button>
      </div>

      {lspError && <p role="alert" className={s.actionError}>{lspError}</p>}
      <div className={s.split}>
        <aside className={s.treePane} data-testid="files-tree-pane">
          {treeQ.isLoading ? (
            <div className={s.loading}><Spinner size={18} /></div>
          ) : treeQ.error ? (
            <div className={s.error}>
              <Icon icon={FolderOpen} size={14} />{' '}
              <span>{(treeQ.error as Error).message}</span>
            </div>
          ) : treeQ.data && treeQ.data.entries.length === 0 ? (
            <div className={s.loading}><em>{t('files.empty')}</em></div>
          ) : (
            <FileTree
              entries={treeQ.data?.entries ?? []}
              selectedPath={selected}
              onSelectFile={setSelected}
            />
          )}
        </aside>

        <section className={s.previewPane} data-testid="files-preview-pane">
          {!selected ? (
            <EmptyState
              icon={<Icon icon={FolderOpen} />}
              title={t('files.noFile')}
              description={t('files.noFileDesc')}
            />
          ) : fileQ.isLoading ? (
            <div className={s.loading}><Spinner size={18} /> <span>{t('files.loadingFile', { name: basename(selected) })}</span></div>
          ) : fileQ.error ? (
            <div className={s.error}>
              <Icon icon={ChevronRight} size={14} />{' '}
              <span>{(fileQ.error as Error).message}</span>
            </div>
          ) : fileQ.data && fileQ.data.binary ? (
            <div className={s.loading}><em>{t('files.binary')}</em></div>
          ) : fileQ.data ? (
            <div className={s.editorWrap}>
              {fileQ.data.truncated && <p className={s.actionError} role="status">{t('files.truncatedReadOnly')}</p>}
              {!readOnly && (
                <div className={s.saveBar}>
                  {draft && draft.text !== draft.base && <span>{t('files.editor.unsaved')}</span>}
                  {((draft && draft.text !== draft.base) || actionError) && (
                    <Button size="sm" variant="ghost" data-testid="files-discard"
                      disabled={saving || !!rejectingPath} onClick={() => void onReload()}>
                      {t(draft && draft.text !== draft.base ? 'files.editor.discard' : 'files.editor.reload')}
                    </Button>
                  )}
                  <Button size="sm" variant="primary" data-testid="files-save"
                    disabled={!draft || draft.text === draft.base || saving || !!rejectingPath}
                    onClick={() => void onSave()}>
                    {t('files.editor.save')}
                  </Button>
                </div>
              )}
              {!readOnly && !saving && hunks.length > 0 && (
                <div className={s.reviewBar} data-testid="files-review-bar">
                  <Badge variant="warning">{t('files.pendingChanges', { count: hunks.length })}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="files-reject-all"
                    onClick={() =>
                      void onRejectAll(bufferRef.current?.() ?? fileQ.data!.content)
                    }
                  >
                    <Icon icon={Undo2} size={12} /> {t('files.rejectAll')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="files-accept-all"
                    onClick={onAcceptAll}
                  >
                    <Icon icon={Check} size={12} /> {t('files.acceptAll')}
                  </Button>
                </div>
              )}
              {actionError && <p role="alert" className={s.actionError}>{actionError}</p>}
              <CodeMirrorEditor
                path={path}
                value={draft?.text ?? fileQ.data.content}
                revision={(contentVersion ?? 0) + resetVersion}
                hunks={readOnly || saving ? [] : hunks}
                readOnly={readOnly}
                onChange={onChange}
                onSave={() => void onSave()}
                onAcceptHunk={onAcceptHunk}
                onRejectHunk={onRejectHunk}
                bufferRef={bufferRef}
              />
              {/* LSP 诊断(Problems)—— 编译器 / 检查器反馈。LSP 开着但
                  看不到诊断是此前的能力缺口:诊断只进了 core 的被动缓存。 */}
              {lsp.enabled && (
                <div className={s.problems} data-testid="files-problems">
                  <div className={s.problemsHeader}>
                    <Icon icon={AlertTriangle} size={12} />
                    <span>{t('files.problems.title')}</span>
                    <Badge variant={diagnostics.length > 0 ? 'warning' : 'neutral'}>
                      {diagnostics.length}
                    </Badge>
                  </div>
                  {diagnostics.length === 0 ? (
                    <p className={s.problemsEmpty}>
                      {diagQ.isLoading ? t('common.loading') : t('files.problems.empty')}
                    </p>
                  ) : (
                    <ul className={s.problemsList}>
                      {diagnostics.map((d, i) => (
                        <li
                          key={`${d.line}-${d.column}-${i}`}
                          className={s.problemRow}
                          data-severity={d.severity}
                        >
                          <span className={s.problemLoc}>
                            {t('files.problems.at', { line: String(d.line), col: String(d.column) })}
                          </span>
                          <span className={s.problemMsg}>{d.message}</span>
                          {d.source && <span className={s.problemSource}>{d.source}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}

function basename(p: string): string {
  // Windows 后端路径是 '\' 分隔,Unix 是 '/';两种都取最右的。
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return p;
  return p.slice(i + 1);
}
