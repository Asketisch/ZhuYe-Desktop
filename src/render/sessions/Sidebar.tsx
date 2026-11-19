/**
 * harness 侧栏滚动区（v3 设计稿移植）—— 纯展示组件。
 *
 * 品牌区 / 固定导航 / 底部用户条由 AppShell 承载；本组件只渲染
 * .sb-scroll 内容：置顶 / 工作区 / 会话（状态点 + 待办旗标 + 计时 + ⋯ 菜单）。
 * 全部交互状态（搜索开关 / 仅看待处理 / 菜单 / 计时）由 SidebarBinding 持有。
 */
import { Filter, Plus, RotateCw, Search, X } from 'lucide-react';
import type { SidebarViewProps } from '@/contracts/sidebar';
import type { SessionBadge } from '@/contracts/shell';
import { Icon } from '../design-system/Icon';

/** 渲染层本地结构类型：会话行的最小字段面（不依赖 utils/commands）。 */
interface SessionRow {
  session_id: string;
  started_at: string;
  title?: string;
}

/** 会话标题：title 优先，回退短 id（与 displayTitle 同口径的最小实现）。 */
function titleOf(sess: SessionRow): string {
  if (sess.title && sess.title.trim()) return sess.title;
  return sess.session_id.slice(0, 8);
}

/** 相对时间：刚刚 / N 分钟 / N 小时 / 昨天 / N 天 / 更早。 */
function relativeTime(iso: string, now: number, t: SidebarViewProps['t']): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return t('harness.sb.timeNow');
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return t('sidebar.bucket.yesterday');
  if (days < 7) return `${days}d`;
  return t('sidebar.bucket.older');
}

/** 运行计时：mm:ss / h:mm:ss。 */
function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function Sidebar({
  t, loading, error, activeId, currentWorkspace, query,
  pinnedGroup, filtered, showEmpty, badges,
  menuFor, onOpenMenu, menuActions, searchOpen, onToggleSearch, pendingOnly, onTogglePendingOnly,
  elapsedNow,
  onSelect, onNewChat, onNewChatIn, onQueryChange, onRefresh,
  onOpenProject, onRemoveWorkspace,
}: SidebarViewProps) {
  const pendingCount = countPending(badges);

  /** 会话行（状态点 + 旗标 + 标题 + 时间/计时 + ⋯）。 */
  const renderSession = (sess: SessionRow) => {
    const badge = badges?.[sess.session_id];
    const dot = badge?.dot ?? 'idle';
    const pending = badge?.pending ?? null;
    const unread = badge?.unread ?? false;
    const elapsed = dot === 'run' ? Math.max(0, elapsedNow - Date.parse(sess.started_at)) : 0;
    return (
      <div key={sess.session_id} className="row-shell">
        <button
          type="button"
          className={[
            'row-item', 'sess',
            sess.session_id === activeId ? 'sel' : '',
            pending ? 'has-pending' : '',
          ].filter(Boolean).join(' ')}
          data-testid={`harness-session-${sess.session_id}`}
          aria-pressed={sess.session_id === activeId}
          onClick={() => onSelect(sess.session_id)}
        >
          <span className={`dot ${dot}`} />
          {pending && (
            <span className="sess-flag" title={pending === 'plan' ? t('harness.sb.pendingFlagPlan') : t('harness.sb.pendingFlagAsk')}>
              {pending === 'plan'
                ? <Icon icon={Filter} size={12} />
                : <span className="sf-q">?</span>}
            </span>
          )}
          {unread && (
            <span className="sess-flag unread" title={t('harness.sb.unreadTip')}>
              <span className="sf-q">✓</span>
            </span>
          )}
          <span className="t">{titleOf(sess)}</span>
          {dot === 'run'
            ? <span className="sess-timer">{fmtElapsed(elapsed)}</span>
            : <span className="tm">{relativeTime(sess.started_at, elapsedNow, t)}</span>}
        </button>
        <button
          type="button"
          className="sess-more"
          data-session-more={sess.session_id}
          data-testid={`session-more-${sess.session_id}`}
          aria-label={t('harness.sb.moreMenu')}
          onClick={() => onOpenMenu(sess.session_id)}
        >⋯</button>
      </div>
    );
  };

  // 仅看待处理：无旗标/未读的会话隐藏（设计稿 sess-pending-only）。
  const visibleSessions = (list: readonly SessionRow[]) =>
    pendingOnly
      ? list.filter((s) => badges?.[s.session_id]?.pending || badges?.[s.session_id]?.unread)
      : list;

  // 全量会话（跨工作区扁平列表，按 started_at 倒序）。
  // 置顶区已渲染的会话不再进扁平列表，避免同一会话出现两行。
  const seen = new Set<string>(pinnedGroup ? pinnedGroup.sessions.map((s) => s.session_id) : []);
  const flat: SessionRow[] = [];
  for (const g of filtered) {
    for (const s of g.sessions) {
      if (!seen.has(s.session_id)) { seen.add(s.session_id); flat.push(s); }
    }
  }
  flat.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

  const menuSession = menuFor ? flat.find((s) => s.session_id === menuFor) : null;

  return (
    <div className="sb-scroll" data-testid="harness-sidebar-scroll">
      {error && <div className="us-empty" role="alert">{error}</div>}
      {loading && flat.length === 0 && <div className="us-empty">{t('sidebar.loading')}</div>}
      {showEmpty && flat.length === 0 && <div className="us-empty">{t('sidebar.empty')}</div>}

      {/* 置顶 */}
      {pinnedGroup && pinnedGroup.sessions.length > 0 && (
        <>
          <div className="sb-label">{t('harness.sb.pinned')}</div>
          {visibleSessions(pinnedGroup.sessions).map(renderSession)}
        </>
      )}

      {/* 工作区 */}
      <div className="sb-label">
        {t('harness.sb.workspaces')}
        <span className="acts">
          <button type="button" title={t('sidebar.searchPlaceholder')} onClick={onToggleSearch}>
            <Icon icon={Search} size={13} />
          </button>
          <button
            type="button"
            title={t('sidebar.openProject')}
            onClick={onOpenProject}
            data-testid="harness-open-project"
          >
            <Icon icon={Plus} size={13} />
          </button>
        </span>
      </div>
      {searchOpen && (
        <input
          className="ask-field"
          style={{ width: '100%', marginBottom: 4 }}
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchAriaLabel')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      )}
      {filtered.map((g) => (
        <div key={g.key} className="row-shell">
          <button
            type="button"
            className={`row-item${g.path === currentWorkspace ? ' sel' : ''}`}
            title={g.path ?? t('sidebar.group.noWorkspace')}
            onClick={() => { if (g.path && onNewChatIn) onNewChatIn(g.path); }}
          >
            <span className="t">{g.label || t('sidebar.group.noWorkspace')}</span>
          </button>
          {g.path && onRemoveWorkspace && (
            <button
              type="button"
              className="sess-more"
              aria-label={t('sidebar.group.remove')}
              title={t('sidebar.group.remove')}
              onClick={() => onRemoveWorkspace(g.path!)}
            >
              <Icon icon={X} size={12} />
            </button>
          )}
        </div>
      ))}

      {/* 会话 */}
      <div className="sb-label">
        {t('harness.sb.sessions')}
        <span className="sb-count" hidden={pendingCount === 0} title={t('harness.sb.pendingTip')} data-testid="harness-sb-count">{pendingCount}</span>
        <span className="acts">
          <button
            type="button"
            title={t('harness.sb.pendingOnly')}
            aria-pressed={pendingOnly}
            className={pendingOnly ? 'on' : undefined}
            onClick={onTogglePendingOnly}
            data-testid="harness-pending-only"
          >
            <Icon icon={Filter} size={13} />
          </button>
          {/* 刷新：后端列表失败后的手动恢复入口（design 稿无此项，能力保留） */}
          {onRefresh && (
            <button type="button" title={t('sidebar.refresh')} onClick={onRefresh} data-testid="harness-refresh">
              <Icon icon={RotateCw} size={13} />
            </button>
          )}
          <button type="button" title={t('sidebar.newChat')} onClick={onNewChat} data-testid="harness-new-chat">
            <Icon icon={Plus} size={13} />
          </button>
        </span>
      </div>
      {visibleSessions(flat).map(renderSession)}

      {/* 会话 ⋯ 浮层菜单（动作回调由绑定层闭包，视图只渲染） */}
      {menuSession && menuActions.length > 0 && (
        <div className="sess-menu" data-testid="harness-session-menu">
          {menuActions.map((action) => (
            <button key={action.key} type="button" onClick={action.run}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 有待办旗标的会话数。 */
function countPending(badges: Record<string, SessionBadge> | undefined): number {
  let n = 0;
  for (const badge of Object.values(badges ?? {})) {
    if (badge.pending) n += 1;
  }
  return n;
}
