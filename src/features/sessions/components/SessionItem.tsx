/**
 * SessionItem —— 单个 session 行（CSS Modules 版）。
 *
 * 契约：主行 button 元素 + aria-pressed（active 反馈）。
 * 传入任一操作 handler 时行尾显示悬停 kebab（⋯）菜单
 * （rename / export / archive / delete，见 SessionItemMenu）。
 * 多选模式（selectable）：行首显示勾选框，点击行/勾选框均切换选中、
 * 不触发导航，kebab 隐藏（批量删除由 Sidebar 的选择条承担）。
 */
import { memo, useState, useRef, useEffect } from 'react';
import type { ReflectSessionInfo } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useBackgroundSessions } from '@/stores/backgroundSessions';
import { displayTitle } from '../utils/buckets';
import { basename } from '../utils/workspaceGroups';
import { SessionItemMenu } from './SessionItemMenu';
import s from '@/render/sessions/components/SessionItem.module.css';

export interface SessionItemProps {
  session: ReflectSessionInfo;
  active: boolean;
  onClick: () => void;
  /** meta 行是否显示归属项目（项目分组视图下由组头承担，可关）。 */
  showWorkspace?: boolean;
  onRename?: (id: string, newName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<string | null>;
  /** fork 历史会话为子会话;成功后由调用方路由切换（返回子 id）。 */
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  /** 置顶态与切换（可选；置顶行标题前显示 📍 标记）。 */
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
  /** 归档列表行：菜单「归档」位切换为「恢复」（onArchive 实际接 unarchive）。 */
  archivedRow?: boolean;
  /** 多选删除（可选）：显示勾选框并参与选中集合。 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

function SessionItemImpl({
  session,
  active,
  onClick,
  showWorkspace = true,
  onRename,
  onDelete,
  onExport,
  onFork,
  onArchive,
  onGenerateTitle,
  pinned,
  onTogglePin,
  archivedRow,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SessionItemProps) {
  const { t } = useI18n();
  // v1.x 后台持续运行:该会话在后台运行中 / 有待确认交互 → 徽标。
  const bg = useBackgroundSessions((state) => state.sessions[session.session_id]);
  const hasActions = Boolean(onRename && onDelete && onExport);
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

  const title = displayTitle(session);
  // workspace 归属:basename 显示在 meta 行,hover 显示全路径;
  // 旧会话(workspace 为 null)显示「未归属」;项目分组视图下由组头承担,可关。
  const wsLabel = session.workspace ? basename(session.workspace) : t('session.noWorkspace');
  // 多选模式：整行点击 = 切换选中（不导航），kebab 隐藏。
  const rowAction = selectable ? () => onToggleSelect?.(session.session_id) : onClick;
  return (
    <div className={s.row} data-selected={selectable && selected ? 'true' : undefined}>
      {selectable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={title || session.session_id}
          className={s.checkbox}
          data-checked={selected || undefined}
          data-testid={`session-select-${session.session_id}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.(session.session_id);
          }}
        >
          {selected ? '✓' : ''}
        </button>
      )}
      <button
        onClick={rowAction}
        aria-pressed={active}
        className={s.item}
        data-active={active || undefined}
      >
        <div className={s.title}>{pinned ? `📍 ${title || t('sidebar.untitled')}` : title || t('sidebar.untitled')}</div>
        <div className={s.meta}>
          {showWorkspace && (
            <>
              <span className={s.workspace} title={session.workspace ?? undefined}>
                {wsLabel}
              </span>
              <span className={s.metaSep}>·</span>
            </>
          )}
          <span>{session.message_count} msgs</span>
          {/* v1.x 后台持续运行:运行中圆点 + 待确认数(gate 请求不落
              rollout,必须切回处理 —— 徽标引导)。仅非活动行显示:活动
              会话的运行态由主 store 投影承担。 */}
          {!active && bg?.running && (
            <span
              className={s.bgDot}
              title={t('chat.backgroundBadgeRunning')}
              data-testid={`session-bg-running-${session.session_id}`}
            />
          )}
          {!active && bg && bg.pendingCount > 0 && (
            <span
              className={s.bgPending}
              title={t('chat.backgroundBadgePending', { n: bg.pendingCount })}
              data-testid={`session-bg-pending-${session.session_id}`}
            >
              ●{bg.pendingCount}
            </span>
          )}
        </div>
      </button>
      {hasActions && !selectable && (
        <button
          ref={kebabRef}
          type="button"
          className={s.kebab}
          aria-label={t('threads.threadActions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid={`session-kebab-${session.session_id}`}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
      )}
      {menuOpen && hasActions && onRename && onDelete && onExport && (
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
          pinned={pinned}
          onTogglePin={
            onTogglePin
              ? () => {
                  onTogglePin(session.session_id);
                  setMenuOpen(false);
                }
              : undefined
          }
          archivedRow={archivedRow}
        />
      )}
    </div>
  );
}

export const SessionItem = memo(SessionItemImpl);
