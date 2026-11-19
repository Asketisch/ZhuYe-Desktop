import { FolderOpen, RefreshCcw, ChevronRight, Check, Undo2, Zap, AlertTriangle } from 'lucide-react';
import type { FilesViewProps } from '@/contracts/files';
import { PageShell } from '../shell/PageShell';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import { EmptyState } from '../design-system/EmptyState';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import s from './FilesView.module.css';

export function FilesView({ t, ctrl, FileTree, CodeMirrorEditor }: FilesViewProps) {
  const { workspace, selected, setSelected, treeQuery: treeQ, fileQuery: fileQ, lsp, lspBusy,
    lspError, toggleLsp: onToggleLsp, diagnostics, diagnosticsQuery: diagQ, readOnly,
    onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll, path, hunks, contentVersion,
    bufferRef } = ctrl;
  const { actionError, rejectingPath, resetVersion, draft, saving, onSave, onReload, onChange } = ctrl.draftController;
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
