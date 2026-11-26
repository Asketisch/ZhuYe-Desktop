import { AlertCircle, AlertTriangle, Info, BellOff, History, AtSign, Inbox } from 'lucide-react';
import type { ComponentType } from 'react';
import type { NotificationsViewProps } from '@/contracts/telemetry/notifications';
import type { NotifItem, NotificationFilter, NotificationTab, ZhuyeActivityEvent } from '@/contracts/telemetry/notifications';
type Filter = NotificationFilter;
type Tab = NotificationTab;
import { Card } from '@/render/harness/design-system/Card';
import { Badge } from '@/render/harness/design-system/Badge';
import { Button } from '@/render/harness/design-system/Button';
import { Icon } from '@/render/harness/design-system/Icon';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import { SegmentedControl } from '@/render/harness/design-system/SegmentedControl';
import { Input } from '@/render/harness/design-system/Input';
import { Spinner } from '@/render/harness/design-system/Spinner';
import s from './NotificationsView.module.css';

const TAB_OPTIONS = [
  { value: 'inbox' as const, label: 'Inbox', hint: 'Live pending events' },
  { value: 'activity' as const, label: 'Activity', hint: 'Audit timeline' },
  { value: 'mentions' as const, label: 'Mentions', hint: '@agent searches' },
];
const LEVEL_FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All' }, { value: 'info' as const, label: 'Info' },
  { value: 'warn' as const, label: 'Warn' }, { value: 'error' as const, label: 'Error' },
];

export function NotificationsView({ ctrl }: NotificationsViewProps) {
  const { osNotify, lastError, clearError, filter, setFilter, tab, setTab, activity, items,
    inboxFiltered, errorCount, pendingCount } = ctrl;
  return (
    <div className={s.root}>
      <header className={s.header}>
        <h1 className={s.title}>Inbox</h1>
        {tab === 'inbox' && items.length > 0 && (
          <div className={s.countBadges}>
            {errorCount > 0 && <Badge variant="danger" solid>{errorCount} error</Badge>}
            {pendingCount > 0 && <Badge variant="warning" solid>{pendingCount} pending</Badge>}
            {errorCount === 0 && pendingCount === 0 && <Badge variant="neutral">{items.length}</Badge>}
          </div>
        )}
        {/* F64/F50:OS 通知开关 —— 回合完成(失焦)与审批请求推系统通知。 */}
        <label
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)' }}
        >
          <input
            type="checkbox"
            checked={osNotify.enabled}
            onChange={(e) => void osNotify.setEnabled(e.target.checked)}
            data-testid="os-notify-toggle"
          />
          OS notifications
        </label>
      </header>

      <div className={s.tabBar}>
        <SegmentedControl<Tab>
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'inbox' && (
        <InboxTab
          items={inboxFiltered}
          filter={filter}
          onFilter={setFilter}
          errorCount={errorCount}
          pendingCount={pendingCount}
          lastError={lastError}
          onClearError={clearError}
        />
      )}

      {tab === 'activity' && <ActivityTab ctrl={activity} />}

      {tab === 'mentions' && <MentionsTab ctrl={activity} />}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function InboxTab(props: {
  items: NotifItem[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  errorCount: number;
  pendingCount: number;
  lastError: string | null;
  onClearError: () => void;
}) {
  const { items, filter, onFilter, errorCount, pendingCount, lastError, onClearError } = props;
  return (
    <>
      <div className={s.filters}>
        <FilterBtn active={filter === 'all'} onClick={() => onFilter('all')}>
          All <span className={s.count}>{items.length}</span>
        </FilterBtn>
        <FilterBtn active={filter === 'error'} onClick={() => onFilter('error')}>
          Errors <span className={s.count}>{errorCount}</span>
        </FilterBtn>
        <FilterBtn active={filter === 'pending'} onClick={() => onFilter('pending')}>
          Pending <span className={s.count}>{pendingCount}</span>
        </FilterBtn>
        {lastError && (
          <Button variant="ghost" size="sm" onClick={onClearError} className={s.dismissBtn}>
            Dismiss error
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={BellOff} />}
            title="No notifications"
            description="Agent events, pending approvals, and server status will appear here."
          />
        </Card>
      ) : (
        <div className={s.list}>
          {items.map((n) => (
            <NotifRow key={n.id} item={n} />
          ))}
        </div>
      )}
    </>
  );
}

function ActivityTab({ ctrl }: { ctrl: NotificationsViewProps['ctrl']['activity'] }) {
  const events = ctrl.activityEvents;
  return (
    <>
      <div className={s.filters}>
        <SegmentedControl<typeof ctrl.level>
          options={LEVEL_FILTER_OPTIONS}
          value={ctrl.level}
          onChange={ctrl.setLevel}
          size="sm"
        />
        <span className={s.count}>{events.length}</span>
        <div className={s.spacer} />
        <Button variant="ghost" size="sm" onClick={() => void ctrl.clear()} data-testid="activity-clear">
          Clear buffer
        </Button>
      </div>

      {ctrl.activityLoading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : ctrl.activityError ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={AlertCircle} />}
            title="Failed to load activity"
            description={String(ctrl.activityError?.message ?? ctrl.activityError)}
          />
        </Card>
      ) : events.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={History} />}
            title="No activity yet"
            description="Agent turns, tool calls, and approvals will accumulate here."
          />
        </Card>
      ) : (
        <div className={s.list}>
          {/* 后端返回旧→新,UI 需要新→旧(最新在上)。 */}
          {[...events].reverse().map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </>
  );
}

function MentionsTab({ ctrl }: { ctrl: NotificationsViewProps['ctrl']['activity'] }) {
  const events = ctrl.mentionEvents;
  return (
    <>
      <div className={s.filters}>
        <Input
          type="text"
          placeholder="@agent-id (e.g. team-lead@rocket)"
          value={ctrl.mentionQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => ctrl.setMentionQuery(e.target.value)}
          className={s.mentionInput}
          data-testid="mention-input"
        />
      </div>

      {ctrl.mentionLoading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : ctrl.mentionError ? (
        <Card level="flat" padding="none">
          <EmptyState icon={<Icon icon={AtSign} />} title="Search failed" />
        </Card>
      ) : events.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={AtSign} />}
            title="No mentions"
            description={
              ctrl.mentionQuery
                ? `No activity mentioning "${ctrl.mentionQuery}".`
                : 'Type a query above (e.g. "@team-lead@rocket") or leave blank to list all mentions.'
            }
          />
        </Card>
      ) : (
        <div className={s.list}>
          {/* 后端返回旧→新,UI 需要新→旧(最新在上)。 */}
          {[...events].reverse().map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </>
  );
}

// ── 行组件 ────────────────────────────────────────────────

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={s.filterBtn} data-active={active || undefined} onClick={onClick}>
      {children}
    </button>
  );
}

const LEVEL_ICON: Record<NotifItem['level'], ComponentType> = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
};

function NotifRow({ item }: { item: NotifItem }) {
  const IconComp = LEVEL_ICON[item.level];
  return (
    <Card level="outlined" padding="md" className={s.notif} data-level={item.level}>
      <div className={s.notifIcon}>
        <Icon icon={IconComp} size={16} />
      </div>
      <div className={s.notifBody}>
        <div className={s.notifTitle}>{item.title}</div>
        {item.body && <div className={s.notifBodyText}>{item.body}</div>}
      </div>
    </Card>
  );
}

const ACTIVITY_ICON: Record<ZhuyeActivityEvent['level'], ComponentType> = {
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const ACTIVITY_BADGE: Record<ZhuyeActivityEvent['level'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warn: 'warning',
  error: 'danger',
};

function ActivityRow({ event }: { event: ZhuyeActivityEvent }) {
  const IconComp = ACTIVITY_ICON[event.level];
  const ts = new Date(event.tsMs).toLocaleString();
  return (
    <Card level="outlined" padding="md" className={s.notif} data-level={event.level}>
      <div className={s.notifIcon}>
        <Icon icon={IconComp} size={16} />
      </div>
      <div className={s.notifBody}>
        <div className={s.notifTitle}>
          {event.summary}
          <Badge variant={ACTIVITY_BADGE[event.level]} className={s.eventBadge}>
            {event.kind.replace(/_/g, ' ')}
          </Badge>
        </div>
        <div className={s.notifMeta}>
          <span>{event.actor.actorId}</span>
          {event.actor.teamName && <span> · {event.actor.teamName}</span>}
          <span> · {ts}</span>
        </div>
      </div>
    </Card>
  );
}

// 抑制 Inbox 图标未使用警告（为未来 Card 装饰保留）
void Inbox;
