/**
 * Notifications —— 三标签 Inbox + Activity timeline + @mentions (Phase 3 条目 9).
 *
 * - **Inbox**:运行时事件通知(派生自 agentStore)。All / Error / Pending 过滤。
 * - **Activity**:本地事件审计 timeline(reflect_list_activity + level 过滤)。
 * - **Mentions**:@<query> 搜索(reflect_search_activity)。
 *
 * Refactored:Activity / Mentions tab 经 `useActivityController` 走 TanStack Query;
 * Inbox tab 保持原有派生逻辑,不变。
 */
import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, BellOff, History, AtSign, Inbox } from 'lucide-react';
import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import {
  Card,
  Badge,
  Button,
  Icon,
  EmptyState,
  SegmentedControl,
  Input,
  Spinner,
} from '@/features/design-system';
import type { ReflectActivityEvent } from '@/utils/commands/activity';
import { useActivityController } from './useActivityController';
import { useOsNotifications } from './useOsNotifications';
import s from './NotificationsView.module.css';

interface NotifItem {
  id: string;
  level: 'error' | 'warn' | 'info';
  title: string;
  body: string;
}

type Filter = 'all' | 'error' | 'pending';
type Tab = 'inbox' | 'activity' | 'mentions';

const TAB_OPTIONS = [
  { value: 'inbox' as const, label: 'Inbox', hint: 'Live pending events' },
  { value: 'activity' as const, label: 'Activity', hint: 'Audit timeline' },
  { value: 'mentions' as const, label: 'Mentions', hint: '@agent searches' },
];

const LEVEL_FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All' },
  { value: 'info' as const, label: 'Info' },
  { value: 'warn' as const, label: 'Warn' },
  { value: 'error' as const, label: 'Error' },
];

export function NotificationsView() {
  const osNotify = useOsNotifications();
  const lastError = useAgentStore((st) => st.lastError);
  const clearError = useAgentStore((st) => st.clearError);
  const approvals = useAgentStore((st) => st.pendingApprovals);
  const questions = useAgentStore((st) => st.pendingQuestions);
  const askUsers = useAgentStore((st) => st.pendingAskUser);
  const plan = useAgentStore((st) => st.pendingPlan);
  const mcpServers = useAgentStore((st) => st.mcpServers);
  const lspServers = useAgentStore((st) => st.lspServers);
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<Tab>('inbox');
  // 单一 activity controller,由父级 `tab` 驱动 query 的 enabled。
  const activity = useActivityController(tab);

  // ── Inbox derivations ────────────────────────────────────────
  const items: NotifItem[] = useMemo(() => {
    const out: NotifItem[] = [];
    if (lastError) {
      out.push({ id: 'err', level: 'error', title: 'Error', body: lastError });
    }
    for (const a of approvals) {
      out.push({
        id: `ap-${a.id}`,
        level: 'warn',
        title: `${a.kind} approval pending`,
        body: a.toolName ? `Tool: ${a.toolName}` : 'Awaiting your decision',
      });
    }
    for (const q of questions) {
      out.push({ id: `q-${q.id}`, level: 'warn', title: 'Question pending', body: 'Agent needs an answer' });
    }
    for (const u of askUsers) {
      out.push({ id: `u-${u.id}`, level: 'warn', title: 'Input pending', body: 'Agent needs your input' });
    }
    if (plan) {
      out.push({ id: 'plan', level: 'warn', title: 'Plan pending', body: 'Review and approve the plan' });
    }
    for (const m of mcpServers) {
      out.push({
        id: `mcp-${m.name}`,
        level: m.status === 'failed' ? 'error' : 'info',
        title: `MCP server ${m.name} ${m.status}`,
        body: m.detail ?? '',
      });
    }
    for (const l of lspServers) {
      out.push({
        id: `lsp-${l.name}`,
        level: l.status === 'failed' ? 'error' : 'info',
        title: `LSP server ${l.name} ${l.status}`,
        body: l.detail ?? '',
      });
    }
    return out;
  }, [lastError, approvals, questions, askUsers, plan, mcpServers, lspServers]);

  const errorCount = items.filter((i) => i.level === 'error').length;
  const pendingCount = items.filter((i) => i.level === 'warn').length;

  const inboxFiltered = items.filter((i) => {
    if (filter === 'error') return i.level === 'error';
    if (filter === 'pending') return i.level === 'warn';
    return true;
  });

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

function ActivityTab({ ctrl }: { ctrl: ReturnType<typeof useActivityController> }) {
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

function MentionsTab({ ctrl }: { ctrl: ReturnType<typeof useActivityController> }) {
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

const ACTIVITY_ICON: Record<ReflectActivityEvent['level'], ComponentType> = {
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const ACTIVITY_BADGE: Record<ReflectActivityEvent['level'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warn: 'warning',
  error: 'danger',
};

function ActivityRow({ event }: { event: ReflectActivityEvent }) {
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
