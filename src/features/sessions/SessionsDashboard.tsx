/**
 * SessionsDashboard —— F50 多会话 Dashboard。
 *
 * 聚合 `reflect_list_sessions` 全量元数据:总会话数 / 总消息数 / 总 token、
 * 按天活跃分布(最近 7 天条形)、最活跃会话 Top5。与 Sidebar(单列表导航)
 * 互补 —— Dashboard 回答「我的会话库整体什么状态」。
 *
 * 纯前端聚合(数据来自既有 IPC,无引擎新命令)。
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard } from 'lucide-react';
import { Badge, Card, Icon } from '@/features/design-system';
import { reflect_list_sessions } from '@/utils/commands/sessions';
import s from './SessionsDashboard.module.css';

/** 最近 N 天活跃分布的天数窗口。 */
export const ACTIVITY_WINDOW_DAYS = 7;

/** 单行聚合统计(纯函数,供测试)。 */
export interface DashboardStats {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  /** 最近 `windowDays` 天内有更新的会话数。 */
  activeInWindow: number;
  /** 按天(距今天数 0..windowDays-1)的活跃会话数。 */
  byDay: number[];
  /** 最活跃会话 Top5(name/id, message_count)。 */
  top: { id: string; name: string; messages: number }[];
}

/** 聚合会话元数据(纯函数)。`now` 由调用方注入以便测试。 */
/** 聚合输入的最小会话形状(结构化兼容:后端/protocol 两种形状均可映射)。 */
export interface SessionMetaLike {
  thread_id: string;
  name?: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  token_total: number;
}

export function aggregate(
  sessions: readonly SessionMetaLike[],
  now: number,
  windowDays = ACTIVITY_WINDOW_DAYS,
): DashboardStats {
  const byDay = new Array<number>(windowDays).fill(0);
  const DAY_MS = 86_400_000;
  let activeInWindow = 0;
  let totalMessages = 0;
  let totalTokens = 0;
  const top = sessions
    .map((x) => ({ id: x.thread_id, name: x.name || x.thread_id, messages: x.message_count }))
    .sort((a, b) => b.messages - a.messages || a.id.localeCompare(b.id))
    .slice(0, 5);

  for (const x of sessions) {
    totalMessages += x.message_count;
    totalTokens += x.token_total;
    const daysAgo = Math.floor((now - x.updated_at) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < windowDays) {
      byDay[daysAgo] += 1;
      activeInWindow += 1;
    }
  }

  return { totalSessions: sessions.length, totalMessages, totalTokens, activeInWindow, byDay, top };
}

export function SessionsDashboard() {
  const sessionsQ = useQuery({
    queryKey: ['dashboard-sessions'],
    queryFn: () => reflect_list_sessions({ limit: 500 }),
    staleTime: 30_000,
  });

  // IPC 形状兼容:后端(session_id/started_at)与 protocol(thread_id/name)
  // 两种返回都归一为聚合输入。
  const stats = useMemo(() => {
    type Raw = Record<string, unknown>;
    const sessions = (sessionsQ.data ?? []).map((rawUnknown) => {
      const x = rawUnknown as unknown as Raw;
      const id = String(x.session_id ?? x.thread_id ?? '');
      const started = Number(x.started_at ?? 0);
      const updated = Number(x.updated_at ?? started);
      return {
        thread_id: id,
        name: String(x.name ?? '') || id,
        created_at: Number(x.created_at ?? started),
        updated_at: updated,
        message_count: Number(x.message_count ?? 0),
        token_total: Number(x.token_total ?? 0),
      };
    });
    return aggregate(sessions, Date.now());
  }, [sessionsQ.data]);

  if (stats.totalSessions === 0) return null;

  const maxDay = Math.max(1, ...stats.byDay);

  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="sessions-dashboard">
      <div className={s.header}>
        <Icon icon={LayoutDashboard} size={13} />
        <strong>多会话 Dashboard</strong>
        <Badge variant="neutral">{stats.totalSessions} 会话</Badge>
      </div>
      <div className={s.grid}>
        <div className={s.stat} data-testid="dashboard-total-messages">
          <span className={s.num}>{stats.totalMessages.toLocaleString()}</span>
          <span className={s.cap}>消息</span>
        </div>
        <div className={s.stat} data-testid="dashboard-total-tokens">
          <span className={s.num}>{stats.totalTokens.toLocaleString()}</span>
          <span className={s.cap}>tokens</span>
        </div>
        <div className={s.stat} data-testid="dashboard-active">
          <span className={s.num}>{stats.activeInWindow}</span>
          <span className={s.cap}>近 {ACTIVITY_WINDOW_DAYS} 天活跃</span>
        </div>
      </div>
      <div className={s.bars} data-testid="dashboard-by-day">
        {stats.byDay.map((count, day) => (
          <div
            key={day}
            className={s.bar}
            style={{ height: `${(count / maxDay) * 100}%` }}
            title={`${day} 天前:${count} 会话活跃`}
            data-count={count}
          />
        ))}
      </div>
      {stats.top.length > 0 && (
        <ul className={s.topList} data-testid="dashboard-top">
          {stats.top.map((x) => (
            <li key={x.id}>
              {x.name} · {x.messages} 条
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
