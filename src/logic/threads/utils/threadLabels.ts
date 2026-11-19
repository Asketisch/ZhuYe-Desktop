/**
 * Threads 工具 —— 链接生成 + 日期格式化。
 */
import type { ReflectSessionInfo } from '@/utils/commands';

/** 生成 chat 路由路径。 */
export function chatLinkFor(session: Pick<ReflectSessionInfo, 'session_id'>): string {
  return `/chat/${session.session_id}`;
}

/** 简短时间标签(用于 thread 行 meta)。 */
export function shortTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return d.toLocaleString();
}