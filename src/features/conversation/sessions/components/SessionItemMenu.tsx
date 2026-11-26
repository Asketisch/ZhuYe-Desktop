/**
 * SessionItemMenu —— session 行的操作下拉菜单（rename / fork / export / archive / delete）。
 *
 * 由 Sidebar（主壳历史列表）与 ThreadsView（/sessions 全量视图）共用；
 * `onArchive` 可选（调用方未接归档能力时不渲染该菜单项）。
 *
 * - rename / fork 用内联表单轻量处理（避免引入新 modal 原语）；
 * - archive / delete 二次确认（应用内 ConfirmDialog —— window.confirm
 *   在 Tauri WKWebView 不弹窗且恒返回 false，不能用作确认）；
 * - export 调 `zhuye_export_session` 并短暂展示导出路径；
 * - fork 调 `zhuye_fork_session` 复制历史到新子会话（分支名经内联
 *   表单输入,默认 `manual`,与 CLI 一致）。
 */
import { useState } from 'react';
import type { ZhuyeSessionInfo } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/features/harness/modals/ConfirmDialog';
import s from '@/render/sessions/components/SessionItemMenu.module.css';

export interface SessionItemMenuProps {
  session: ZhuyeSessionInfo;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onExport: () => Promise<string | null>;
  /** 可选：fork 出子会话（入参为分支名,写入子会话自定义名）。 */
  onFork?: (branch: string) => Promise<void>;
  /** 可选：归档（移出会话列表，可在归档区恢复）。 */
  onArchive?: () => Promise<void>;
  /** 可选：AI 重新生成标题（B；未接时隐藏菜单项）。 */
  onGenerateTitle?: () => Promise<string>;
  /** 可选：置顶切换（未接时隐藏菜单项）。 */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** 归档列表行：「归档」菜单项切换为「恢复」（onArchive 实际接 unarchive）。 */
  archivedRow?: boolean;
}

export function SessionItemMenu({ session, onRename, onDelete, onExport, onFork, onArchive, onGenerateTitle, pinned, onTogglePin, archivedRow }: SessionItemMenuProps) {
  const { t } = useI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  // 预填充当前标题(自定义名或派生值;无标题的空会话为空串)。
  const [renameValue, setRenameValue] = useState(session.title ?? '');
  // fork 分支名表单（默认 manual,与 CLI `zhuye session fork` 一致）。
  const [forkOpen, setForkOpen] = useState(false);
  const [forkValue, setForkValue] = useState('manual');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameOpen(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onRename(trimmed);
      setRenameOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const handleArchive = () =>
    run(async () => {
      const ok = await confirmDialog({
        title: t('threads.archive'),
        message: t('threads.archiveConfirm', { id: session.session_id }),
        confirmLabel: t('threads.archive'),
      });
      if (ok) await onArchive?.();
    });

  const handleDelete = () =>
    run(async () => {
      const ok = await confirmDialog({
        title: t('threads.delete'),
        message: t('threads.deleteConfirm', { id: session.session_id }),
        confirmLabel: t('common.delete'),
      });
      if (ok) await onDelete();
    });

  const handleExport = () =>
    run(async () => {
      const path = await onExport();
      if (path) {
        setExportPath(path);
        setTimeout(() => setExportPath(null), 3000);
      }
    });

  const handleGenerateTitle = () =>
    run(async () => {
      await onGenerateTitle?.();
    });

  const handleFork = () => {
    const branch = forkValue.trim();
    if (!branch) return;
    void run(async () => {
      await onFork?.(branch);
    });
  };

  if (renameOpen || forkOpen) {
    const isFork = forkOpen;
    return (
      <div className={s.menu} data-session-menu={session.session_id} role="dialog" aria-label={t(isFork ? 'threads.fork' : 'threads.renameThread')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isFork) {
              handleFork();
            } else {
              void handleRename();
            }
          }}
        >
          <input
            type="text"
            value={isFork ? forkValue : renameValue}
            onChange={(e) => (isFork ? setForkValue(e.target.value) : setRenameValue(e.target.value))}
            placeholder={t(isFork ? 'threads.forkBranchName' : 'threads.threadName')}
            disabled={pending}
            autoFocus
            className={s.input}
            data-testid={isFork ? `session-fork-input-${session.session_id}` : `session-rename-input-${session.session_id}`}
          />
          <div className={s.actions}>
            <button
              type="button"
              onClick={() => (isFork ? setForkOpen(false) : setRenameOpen(false))}
              disabled={pending}
            >
              {t('threads.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending || (isFork ? !forkValue.trim() : !renameValue.trim())}
              data-testid={isFork ? `session-fork-confirm-${session.session_id}` : undefined}
            >
              {pending ? t('threads.saving') : t(isFork ? 'threads.fork' : 'threads.save')}
            </button>
          </div>
        </form>
        {isFork && <div className={s.hint}>{t('threads.forkHint')}</div>}
        {error && <div className={s.error}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={s.menu} data-session-menu={session.session_id} role="menu" aria-label={t('threads.threadActions')}>
      {onTogglePin && (
        <button
          type="button"
          role="menuitem"
          className={s.item}
          onClick={onTogglePin}
          data-testid={`session-pin-${session.session_id}`}
        >
          {pinned ? t('threads.unpin') : t('threads.pin')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={s.item}
        onClick={() => setRenameOpen(true)}
        disabled={pending}
        data-testid={`session-rename-${session.session_id}`}
      >
        {t('threads.rename')}
      </button>
      {onGenerateTitle && (
        <button
          type="button"
          role="menuitem"
          className={s.item}
          onClick={() => void handleGenerateTitle()}
          disabled={pending}
          data-testid={`session-ai-rename-${session.session_id}`}
        >
          {t('threads.aiRename')}
        </button>
      )}
      {onFork && (
        <button
          type="button"
          role="menuitem"
          className={s.item}
          onClick={() => setForkOpen(true)}
          disabled={pending}
          data-testid={`session-fork-${session.session_id}`}
        >
          {t('threads.fork')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={s.item}
        onClick={() => void handleExport()}
        disabled={pending}
        data-testid={`session-export-${session.session_id}`}
      >
        {t('threads.export')}
      </button>
      {onArchive && (
        <button
          type="button"
          role="menuitem"
          className={s.item}
          onClick={() => void handleArchive()}
          disabled={pending}
          data-testid={`session-archive-${session.session_id}`}
        >
          {archivedRow ? t('threads.unarchive') : t('threads.archive')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={`${s.item} ${s.danger}`}
        onClick={() => void handleDelete()}
        disabled={pending}
        data-testid={`session-delete-${session.session_id}`}
      >
        {t('threads.delete')}
      </button>
      {exportPath && (
        <div className={s.toast} role="status">
          {t('threads.exported', { path: exportPath })}
        </div>
      )}
      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}
