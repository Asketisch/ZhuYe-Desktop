/**
 * harness 侧栏滚动区（v3 设计稿移植）—— 纯展示组件。
 *
 * 品牌区 / 固定导航 / 底部用户条由 AppShell 承载；本组件只渲染
 * .sb-scroll 内容：置顶 / 工作区 / 会话（状态点 + 待办旗标 + 计时 + ⋯ 菜单）。
 * 全部交互状态（搜索开关 / 仅看待处理 / 菜单 / 计时）由 SidebarBinding 持有。
 */
import { ChevronDown, ChevronRight, Filter, Plus, RotateCw, Search, X } from 'lucide-react';
import type { SidebarViewProps } from '@/contracts/sidebar';
import type { SessionBadge } from '@/contracts/shell';
import { Icon } from '../design-system/Icon';

/** 渲染层本地结构类型：会话行的最小字段面（不依赖 utils/commands）。 */
interface SessionRow {
  session_id: string;
  started_at: string;
  title?: string;
  /** v1.12:子代理会话（血缘来自 SessionMeta.parent_session_id）——
   * 渲染在父会话行下缩进展示（minimax code 形态）。 */
  children?: SessionRow[];
}

/** 子会话折叠阈值：超过则默认折叠，行尾「显示全部 N 个」展开。 */
const SUB_SESSION_FOLD_LIMIT = 3;

export interface SubSessionsFold {
  /** 已展开的父会话 id 集合（> 阈值的父会话默认折叠）。 */
  expanded: ReadonlySet<string>;
  toggle: (sessionId: string) => void;
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
  menuFor, onOpenMenu, menuActions, SessionMenu, renameId, renameValue, onRenameValueChange, onSubmitRename, onCancelRename, searchOpen, onToggleSearch, pendingOnly, onTogglePendingOnly,
  elapsedNow, isCollapsed, onToggleGroup, searching,
  onSelect, onNewChat, onNewChatIn, onQueryChange, onRefresh,
  onOpenProject, onRemoveWorkspace,
  subSessionsFold,
}: SidebarViewProps) {
  const pendingCount = countPending(badges);
  // 子会话展开集合 —— 状态由 SidebarBinding 持有(渲染层边界禁 hook)。

  /** 会话行（状态点 + 旗标 + 标题 + 时间/计时 + ⋯）。 */
  const renderSession = (sess: SessionRow) => {
    const badge = badges?.[sess.session_id];
    const dot = badge?.dot ?? 'idle';
    const pending = badge?.pending ?? null;
    const unread = badge?.unread ?? false;
    // 回合计时口径:badge.since(当前回合起点) —— 不得用会话创建时间
    // 冒充(实测 bug #9:历史会话计时 25h)。起点未知 → 只显示呼吸点。
    const since = badge?.since ?? null;
    const elapsed = dot === 'run' && since ? Math.max(0, elapsedNow - since) : 0;
    const subKids = sess.children ?? [];
    const subExpanded = subSessionsFold.expanded.has(sess.session_id);
    const subShown = subKids.length <= SUB_SESSION_FOLD_LIMIT || subExpanded
      ? subKids
      : subKids.slice(0, SUB_SESSION_FOLD_LIMIT);
    return (
      <div key={sess.session_id} className="row-shell">
        {renameId === sess.session_id ? <input className="ask-field session-rename" autoFocus
          aria-label={t('sidebar.renamePrompt')} value={renameValue} onChange={(e) => onRenameValueChange(e.target.value)}
          onBlur={onSubmitRename} onKeyDown={(e) => { if (e.key === 'Enter') onSubmitRename(); if (e.key === 'Escape') onCancelRename(); }} /> : <button
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
            ? (since
              ? <span className="sess-timer">{fmtElapsed(elapsed)}</span>
              : <span className="sess-timer" title={t('harness.sb.timeNow')}>●</span>)
            : <span className="tm">{relativeTime(sess.started_at, elapsedNow, t)}</span>}
        </button>}
        <button
          type="button"
          className="sess-more"
          data-session-more={sess.session_id}
          data-testid={`session-more-${sess.session_id}`}
          aria-label={t('harness.sb.moreMenu')}
          onClick={() => onOpenMenu(sess.session_id)}
        >⋯</button>
        {subKids.length > 0 && (
          <div className="sub-sessions" data-testid={`sub-sessions-${sess.session_id}`}>
            {subShown.map((kid) => (
              <button
                key={kid.session_id}
                type="button"
                className={['row-item', 'sess', 'sub-session', kid.session_id === activeId ? 'sel' : ''].filter(Boolean).join(' ')}
                data-testid={`harness-subsession-${kid.session_id}`}
                aria-pressed={kid.session_id === activeId}
                /* 子代理会话是主会话流的投影:引擎宿主不可 bind 子线程
                 * (实测 bind 被 workspace 校验拒绝)。点击 = 打开父会话 ——
                 * 子代理的调用记录与产出都在主会话流里。 */
                onClick={() => onSelect(sess.session_id)}
              >
                <span className="dot sub-dot" />
                <span className="t">{titleOf(kid)}</span>
                <span className="tm">{relativeTime(kid.started_at, elapsedNow, t)}</span>
              </button>
            ))}
            {subKids.length > SUB_SESSION_FOLD_LIMIT && (
              <button
                type="button"
                className="sub-fold-toggle"
                onClick={() => subSessionsFold.toggle(sess.session_id)}
              >
                {subExpanded
                  ? t('harness.sb.subCollapse')
                  : t('harness.sb.subExpand', { n: String(subKids.length) })}
              </button>
            )}
          </div>
        )}
        {menuFor === sess.session_id && menuActions.length > 0 && (
          <SessionMenu sessionId={sess.session_id} actions={menuActions} onClose={() => onOpenMenu(null)} />
        )}
      </div>
    );
  };

  // 仅看待处理：无旗标/未读的会话隐藏（设计稿 sess-pending-only）。
  const visibleSessions = (list: readonly SessionRow[]) =>
    pendingOnly
      ? list.filter((s) => badges?.[s.session_id]?.pending || badges?.[s.session_id]?.unread)
      : list;

  // 统计过滤后的会话，以判断加载和空状态。
  const seen = new Set<string>(pinnedGroup ? pinnedGroup.sessions.map((s) => s.session_id) : []);
  const flat: SessionRow[] = [];
  for (const g of filtered) {
    for (const s of g.sessions) {
      if (!seen.has(s.session_id)) { seen.add(s.session_id); flat.push(s); }
    }
  }
  flat.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

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

      {filtered.map((g) => {
        const collapsed = !searching && isCollapsed(g.key);
        return <div key={g.key}>
          <div className="row-shell">
            <button type="button" className={`row-item${g.path === currentWorkspace ? ' sel' : ''}`}
              title={g.path ?? t('sidebar.group.noWorkspace')} aria-expanded={!collapsed}
              onClick={() => onToggleGroup(g.key)}>
              <Icon icon={collapsed ? ChevronRight : ChevronDown} size={13} />
              <span className="t">{g.label || t('sidebar.group.noWorkspace')}</span>
            </button>
            {g.path && onNewChatIn && <button type="button" className="workspace-new" data-testid={`workspace-new-${g.key}`} title={t('sidebar.newChat')} aria-label={t('sidebar.newChat')} onClick={() => onNewChatIn(g.path!)}><Icon icon={Plus} size={12} /></button>}
            {g.path && onRemoveWorkspace && <button type="button" className="sess-more" aria-label={t('sidebar.group.remove')} title={t('sidebar.group.remove')} onClick={() => onRemoveWorkspace(g.path!)}><Icon icon={X} size={12} /></button>}
          </div>
          {!collapsed && <div className="workspace-sessions">{visibleSessions(g.sessions).map(renderSession)}</div>}
        </div>;
      })}


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
