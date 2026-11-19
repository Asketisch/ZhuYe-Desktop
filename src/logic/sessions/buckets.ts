/**
 * Session bucket 工具 —— 时间分桶规则。
 *
 * 纯函数，便于测试与跨 feature 复用。
 */
import type { ReflectSessionInfo } from '@/utils/commands';

export const SESSION_BUCKET_LABELS = [
  'Now',
  'Today',
  'Yesterday',
  'This week',
  'Older',
] as const;

export type SessionBucketLabel = (typeof SESSION_BUCKET_LABELS)[number];

export interface SessionBucket {
  label: SessionBucketLabel;
  sessions: ReflectSessionInfo[];
}

/** 单个 session → 桶标签。 */
export function bucketFor(session: ReflectSessionInfo, now: number = Date.now()): SessionBucketLabel {
  const t = Date.parse(session.started_at);
  if (Number.isNaN(t)) return 'Older';
  const ageMs = now - t;
  const h = ageMs / (1000 * 60 * 60);
  if (h < 1) return 'Now';
  if (h < 24) return 'Today';
  const d = h / 24;
  if (d < 2) return 'Yesterday';
  if (d < 7) return 'This week';
  return 'Older';
}

/** 整列表 → 分桶结构(顺序固定,空桶省略)。 */
export function bucketSessions(sessions: ReflectSessionInfo[], now: number = Date.now()): SessionBucket[] {
  if (sessions.length === 0) return [];
  const groups = new Map<SessionBucketLabel, ReflectSessionInfo[]>();
  for (const s of sessions) {
    const k = bucketFor(s, now);
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
    }
    arr.push(s);
  }
  return SESSION_BUCKET_LABELS.filter((l) => groups.has(l)).map((l) => ({
    label: l,
    sessions: groups.get(l)!,
  }));
}

/**
 * 解析显示名:优先用后端派生的会话标题(`SessionInfo.title` ——
 * 自定义名或首条 user 消息预览);无标题时回退 id 前 8 字符。
 */
export function displayTitle(session: Pick<ReflectSessionInfo, 'session_id' | 'title'>): string {
  const title = session.title?.trim();
  return title ? title : session.session_id.slice(0, 8);
}