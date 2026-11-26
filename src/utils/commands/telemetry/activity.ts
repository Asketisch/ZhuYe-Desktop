/**
 * 活动时间线 IPC 包装（Phase 3 条目 9）。
 *
 * 薄包装 `zhuye_list_activity` / `zhuye_search_activity` /
 * `zhuye_clear_activity` / `zhuye_activity_count` 四个命令。
 * 与后端 `zhuye_app_core::activity::{ActivityEvent, ActivityFilter, Actor}`
 * camelCase 类型对齐。
 */
import { invoke } from '@/utils/bridge';

// ── Actor (与 app-core/src/actor.rs 对齐) ──────────────────────────

export type ZhuyeActorType = 'human' | 'agent' | 'system';

export type ZhuyeActorKind = 'user' | 'lead' | 'member' | 'system';

export interface ZhuyeActor {
  actorType: ZhuyeActorType;
  actorId: string;
  kind: ZhuyeActorKind;
  displayName?: string;
  teamName?: string;
}

// ── Activity kinds / levels ────────────────────────────────────────

export type ZhuyeActivityKind =
  | 'turn_started'
  | 'turn_complete'
  | 'turn_aborted'
  | 'agent_message'
  | 'tool_call_begin'
  | 'tool_call_end'
  | 'approval_request'
  | 'plan_request'
  | 'plan_approved'
  | 'plan_rejected'
  | 'task_created'
  | 'task_completed'
  | 'task_updated'
  | 'task_claimed'
  | 'team_created'
  | 'team_deleted'
  | 'mention'
  | 'error'
  | 'session_configured'
  | 'permission_mode_changed'
  | 'mcp_server'
  | 'lsp_server'
  | 'context_compacted'
  | 'other';

export type ZhuyeActivityLevel = 'info' | 'warn' | 'error';

export interface ZhuyeActivityEvent {
  id: string;
  tsMs: number;
  kind: ZhuyeActivityKind;
  actor: ZhuyeActor;
  summary: string;
  taskId?: number;
  teamName?: string;
  level: ZhuyeActivityLevel;
}

export interface ZhuyeActivityFilter {
  kind?: ZhuyeActivityKind;
  level?: ZhuyeActivityLevel;
  actorId?: string;
  teamName?: string;
  sinceMs?: number;
  limit?: number;
}

// ── Wrappers ───────────────────────────────────────────────────────

export function zhuye_list_activity(
  filter?: ZhuyeActivityFilter,
): Promise<ZhuyeActivityEvent[]> {
  return invoke('zhuye_list_activity', { filter: filter ?? null });
}

export function zhuye_search_activity(query: string): Promise<ZhuyeActivityEvent[]> {
  return invoke('zhuye_search_activity', { query });
}

export function zhuye_clear_activity(): Promise<void> {
  return invoke('zhuye_clear_activity');
}

export function zhuye_activity_count(): Promise<number> {
  return invoke('zhuye_activity_count');
}

/**
 * 从文本里提取 `@<token>` 形式的 mention。
 *
 * token 允许 `@team-lead@rocket`(嵌套 @)与 `@user` / `@system`。
 * 用于 composer mention 高亮 + Activity mentions 子视图过滤。
 */
export function extractMentions(text: string): string[] {
  const re = /@([a-z0-9_@-]+)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}
