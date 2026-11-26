/**
 * ThreadItem —— 单个 thread 行（CSS Modules 版）。
 * 用 router Link，保留 data-active 契约。
 *
 * B3-03: kebab 菜单(⋯) — rename / export / archive / delete。
 * 菜单本体是共享组件 `sessions/components/SessionItemMenu`。
 */
import { useState, useRef, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import type { ZhuyeSessionInfo } from '@/utils/commands';
import { chatLinkFor, shortTimestamp } from '@/logic/threads/utils/threadLabels';
import { SessionItemMenu } from '@/features/conversation/sessions/components/SessionItemMenu';
import { useI18n } from '@/utils/i18n';
import s from '@/render/conversation/threads/components/ThreadItem.module.css';

export interface ThreadItemProps {
  session: ZhuyeSessionInfo;
  active: boolean;
  onClick: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<string | null>;
  /** fork 历史会话为子会话（可选；成功后由调用方路由切换）。 */
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  /** 多选删除（可选）：显示勾选框并参与选中集合。 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function ThreadItem({
  session,
  active,
  onClick,
  onRename,
  onDelete,
  onExport,
  onFork,
  onArchive,
  onGenerateTitle,
  selectable = false,
  selected = false,
  onToggleSelect,
}: ThreadItemProps) {
  const { tp, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef<HTMLButtonElement | null>(null);

  // 外部点击 / Esc 时关闭菜单。
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (kebabRef.current?.contains(target)) return;
      const menuEl = document.querySelector(`[data-session-menu="${session.session_id}"]`);
      if (menuEl?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, session.session_id]);

  return (
    <li className={s.row} data-selected={selectable && selected ? 'true' : undefined}>
      {selectable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={session.title || session.session_id}
          className={s.checkbox}
          data-checked={selected || undefined}
          data-testid={`thread-select-${session.session_id}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.(session.session_id);
          }}
        >
          {selected ? '✓' : ''}
        </button>
      )}
      <Link
        to="/chat/$sessionId"
        params={{ sessionId: session.session_id }}
        onClick={onClick}
        className={s.link}
        data-active={active ? 'true' : 'false'}
        data-href={chatLinkFor(session)}
      >
        <div className={s.title}>
          {session.title || session.session_id.slice(0, 8)}
        </div>
        <div className={s.meta}>
          {shortTimestamp(session.started_at)} · {tp('threads.msgCount', session.message_count)}
        </div>
      </Link>
      <button
        ref={kebabRef}
        type="button"
        className={s.kebab}
        aria-label={t('threads.threadActions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid={`thread-kebab-${session.session_id}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {menuOpen && (
        <SessionItemMenu
          session={session}
          onRename={async (newName) => {
            await onRename(session.session_id, newName);
            setMenuOpen(false);
          }}
          onDelete={async () => {
            await onDelete(session.session_id);
            setMenuOpen(false);
          }}
          onExport={async () => {
            const path = await onExport(session.session_id);
            setMenuOpen(false);
            return path;
          }}
          onFork={
            onFork
              ? async (branch) => {
                  await onFork(session.session_id, branch);
                  setMenuOpen(false);
                }
              : undefined
          }
          onArchive={
            onArchive
              ? async () => {
                  await onArchive(session.session_id);
                  setMenuOpen(false);
                }
              : undefined
          }
          onGenerateTitle={
            onGenerateTitle
              ? async () => {
                  const title = await onGenerateTitle(session.session_id);
                  setMenuOpen(false);
                  return title;
                }
              : undefined
          }
        />
      )}
    </li>
  );
}
