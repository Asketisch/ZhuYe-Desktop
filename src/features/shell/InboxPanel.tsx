/**
 * InboxPanel —— 任务中心（多会话调度台，v3 设计稿移植）。
 *
 * 不切换会话就能总览其他会话的待批准计划 / 待回答提问。已知工程约束
 * （backgroundSessions 注释同步）：后台会话的 gate 交互不能远程应答，
 * 必须切回该会话操作 —— 所以卡片的主动作是「跳到会话」，由会话内的
 * 审批 / 提问弹窗承接真正的决策（payload 语义在弹窗层处理，不在此复制）。
 *
 * 已完成页签：后台跑完但未被打开过的会话（shellUi.unread 注册表）。
 */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useShellUi, type InboxTab } from '@/stores/shellUi';
import { useSessions, useActiveSession } from '@/logic/sessions/useSessions';
import { useSessionBadges } from '@/logic/shell/useSessionBadges';
import { useI18n } from '@/utils/i18n';
import { displayTitle } from '@/features/sessions/utils/buckets';

export function InboxPanel({ inboxTab }: { inboxTab: InboxTab; onNavigateSession: (id: string) => void }) {
  const { t } = useI18n();
  const ui = useShellUi();
  const sessions = useSessions();
  const { activeId, setActiveId } = useActiveSession();

  const sessionIds = useMemo(() => sessions.all.map((s) => s.session_id), [sessions.all]);
  const unreadRegistry = useMemo(() => ({
    unread: ui.unread,
    markRead: ui.markRead,
    markUnread: ui.markUnread,
  }), [ui.unread, ui.markRead, ui.markUnread]);
  const { badges, pendingCount } = useSessionBadges(activeId, sessionIds, unreadRegistry);

  const titleOf = (id: string) => {
    const sess = sessions.all.find((s) => s.session_id === id);
    return sess ? (displayTitle(sess) || t('sidebar.untitled')) : id;
  };
  const timeOf = (id: string) => {
    const sess = sessions.all.find((s) => s.session_id === id);
    if (!sess) return '';
    const ts = Date.parse(sess.started_at);
    if (Number.isNaN(ts)) return '';
    const minutes = Math.floor((Date.now() - ts) / 60_000);
    if (minutes < 1) return t('harness.sb.timeNow');
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
  };

  const pendingList = useMemo(
    () => sessionIds.filter((id) => badges[id]?.pending),
    [sessionIds, badges],
  );
  const doneList = useMemo(
    () => Object.keys(ui.unread),
    [ui.unread],
  );

  const jump = (id: string) => {
    setActiveId(id);
    ui.closeInbox();
  };

  const doneCount = doneList.length;
  return (
    <div className="inbox-wrap on" data-testid="harness-inbox-panel">
      <div className="inbox">
        <div className="inbox-head">
          <b>{t('harness.inbox.title')}</b>
          <span className="inbox-sub">{pendingCount} · {doneCount}</span>
          <span className="tp-spacer" />
          <button type="button" className="tb-btn" title="Esc" onClick={ui.closeInbox} data-testid="harness-inbox-close">
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <div className="inbox-tabs">
          <button
            type="button"
            className={inboxTab === 'todo' ? 'on' : ''}
            onClick={() => ui.setInboxTab('todo')}
            data-testid="harness-inbox-tab-todo"
          >
            {t('harness.inbox.todo')} <i>{pendingCount}</i>
          </button>
          <button
            type="button"
            className={inboxTab === 'done' ? 'on' : ''}
            onClick={() => ui.setInboxTab('done')}
            data-testid="harness-inbox-tab-done"
          >
            {t('harness.inbox.done')} <i>{doneCount}</i>
          </button>
        </div>
        <div className="inbox-body" data-testid="harness-inbox-body">
          {inboxTab === 'todo' ? (
            pendingList.length === 0 ? (
              <div className="ib-empty">{t('harness.inbox.emptyTodo')}</div>
            ) : (
              pendingList.map((id) => {
                const flag = badges[id]?.pending;
                return (
                  <div key={id} className="ib-card" data-testid={`harness-inbox-card-${id}`}>
                    <div className="ib-top">
                      <span className="ib-kind">{flag === 'plan' ? t('harness.inbox.kindPlan') : t('harness.inbox.kindAsk')}</span>
                      <span className="ib-sess">{titleOf(id)}</span>
                      <span className="mono">{timeOf(id)}</span>
                    </div>
                    <div className="ib-actions">
                      <button type="button" className="btn primary" onClick={() => jump(id)}>
                        {t('harness.inbox.jump')}
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            doneList.length === 0 ? (
              <div className="ib-empty">{t('harness.inbox.emptyDone')}</div>
            ) : (
              doneList.map((id) => (
                <div key={id} className="ib-card done" data-testid={`harness-inbox-done-${id}`}>
                  <div className="ib-top">
                    <span className="ib-kind">{t('harness.inbox.kindDone')}</span>
                    <span className="ib-sess">{titleOf(id)}</span>
                    <span className="mono">{timeOf(id)}</span>
                  </div>
                  <div className="ib-actions">
                    <button type="button" className="ib-jump" onClick={() => jump(id)}>
                      {t('harness.inbox.jump')}
                    </button>
                  </div>
                </div>
              ))
            )
          )}
        </div>
        <div className="inbox-foot">
          <span>{t('harness.inbox.footShortcut')}</span>
          <span>{t('harness.inbox.footNote')}</span>
        </div>
      </div>
    </div>
  );
}
