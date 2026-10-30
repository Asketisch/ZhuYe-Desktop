/**
 * Session I/O —— 列表 / 回放 / 重命名 / 删除 / 归档 / 导出。
 *
 * `ReflectRolloutRecord` 故意采用 `Record<string, unknown>` 形态,
 * 因为 Rust 端返回的是按协议判别的联合类型;TS 视图见
 * `src/types/protocol.ts`。
 */
import { invoke } from '../bridge';
import { waitForWorkspaceSwitches } from './workspaces';
import type { ReflectRolloutRecord, ReflectSessionInfo } from '../types';

/** `reflect_list_sessions` 返回的 session 元数据。 */
export type { ReflectSessionInfo } from '../types';

/** `reflect_export_session_markdown` 的返回结果。 */
export interface ReflectMarkdownExportResult {
  path: string;
  bytes: number;
}

/**
 * 分页获取会话列表。`limit` 与 `offset` 均可选。
 *
 * `workspace` 为当前工作区绝对路径时只返回归属该工作区的会话;
 * `null` / 省略 → 全量(含未归属旧会话)。
 */
export async function reflect_list_sessions(
  opts: { workspace?: string | null; limit?: number; offset?: number } = {},
): Promise<ReflectSessionInfo[]> {
  return invoke<ReflectSessionInfo[]>('reflect_list_sessions', {
    workspace: opts.workspace ?? null,
    limit: opts.limit ?? null,
    offset: opts.offset ?? null,
  });
}

/** 预分配一个新会话 id(前端路由用)。workspace 归属由首条提交携带。 */
export async function reflect_create_session(): Promise<string> {
  return invoke<string>('reflect_create_session');
}

/**
 * 把后端 AgentThread 绑到指定 session id(ChatView 挂载时调用)。
 *
 * 后端幂等:同 id 二次 bind 直接短路。未知 id(磁盘无对应 JSONL,
 * 如刚由 `reflect_create_session` 分配)走空历史分支,不报错。
 *
 * 返回绑定后线程的当前 PermissionMode(线格式字符串)。历史会话的
 * 模式从 JSONL 审计轨迹恢复(绑定会话而非进程),前端据此同步
 * 权限模式徽标/切换器。
 */
let bindQueue: Promise<void> = Promise.resolve();

export function reflect_bind_session(id: string): Promise<string> {
  const result = bindQueue.then(async () => {
    await waitForWorkspaceSwitches();
    return invoke<string>('reflect_bind_session', { id });
  });
  bindQueue = result.then(() => {}, () => {});
  return result;
}

/** 按 id 重命名已有会话。 */
export async function reflect_rename_session(id: string, new_name: string): Promise<void> {
  return invoke<void>('reflect_rename_session', { id, newName: new_name });
}

/**
 * 基于历史会话 fork 出子会话（CLI `reflect session fork` 的 GUI 入口）。
 *
 * 后端复制父会话 JSONL（`up_to_turn_id` 可选截至某 turn，含）生成新
 * session id，父文件写 Fork 血缘 marker，并把 `branch` 写成子会话的
 * 自定义名。返回子会话 id —— 调用方自行路由切换（ChatView 挂载时
 * bind + replay 即得完整历史）。
 */
export async function reflect_fork_session(
  id: string,
  branch?: string,
  up_to_turn_id?: string,
): Promise<string> {
  return invoke<string>('reflect_fork_session', {
    id,
    branch: branch ?? null,
    upToTurnId: up_to_turn_id ?? null,
  });
}

/**
 * AI 生成会话标题（B）。返回最终标题文本。
 *
 * - `force = false`（省略）：turn 收尾自动触发 —— 已有自定义名或 AI 标题时
 *   幂等返回，不重复调模型；
 * - `force = true`：菜单「AI 重命名」—— 重新生成并覆盖 AI 标题
 *   （自定义名仍然优先，不会被覆盖）。
 */
export async function reflect_generate_session_title(id: string, force = false): Promise<string> {
  return invoke<string>('reflect_generate_session_title', { id, force });
}

/** 按 id 删除已有会话。 */
export async function reflect_delete_session(id: string): Promise<void> {
  return invoke<void>('reflect_delete_session', { id });
}

/** 按 id 归档会话（文件移出 sessions 树，列表/回放不再命中）。 */
export async function reflect_archive_session(id: string): Promise<void> {
  return invoke<void>('reflect_archive_session', { id });
}

/** 按 id 恢复已归档会话（沿原相对路径搬回）。 */
export async function reflect_unarchive_session(id: string): Promise<void> {
  return invoke<void>('reflect_unarchive_session', { id });
}

/**
 * 列出已归档会话。`workspace` 过滤语义与 `reflect_list_sessions` 一致。
 */
export async function reflect_list_archived_sessions(
  workspace?: string | null,
): Promise<ReflectSessionInfo[]> {
  return invoke<ReflectSessionInfo[]>('reflect_list_archived_sessions', {
    workspace: workspace ?? null,
  });
}

/** 回放会话:返回原始事件所产生的 rollout record 流。 */
export async function reflect_replay_session(id: string): Promise<ReflectRolloutRecord[]> {
  return invoke<ReflectRolloutRecord[]>('reflect_replay_session', { id });
}

/** 将会话导出为 JSON,返回绝对路径。 */
export async function reflect_export_session(id: string): Promise<string | null> {
  return invoke<string | null>('reflect_export_session', { id });
}

/** 将会话导出为 Markdown,返回渲染后的文件路径。 */
export async function reflect_export_session_markdown(
  id: string,
): Promise<ReflectMarkdownExportResult | null> {
  return invoke<ReflectMarkdownExportResult | null>('reflect_export_session_markdown', { id });
}

/** 跨会话内容搜索命中（后端 grep 会话 JSONL 的 user/assistant 文本）。 */
export interface ReflectSessionSearchHit {
  session_id: string;
  title: string | null;
  /** 首个命中片段（前后 ~60 字符，空白已折叠）。 */
  snippet: string;
  started_at: string;
  message_count: number;
  match_count: number;
}

/** 跨会话全文搜索（大小写不敏感；覆盖活跃树 + 归档树，最近 120 个会话）。 */
export async function reflect_search_sessions(query: string, limit?: number): Promise<ReflectSessionSearchHit[]> {
  return invoke<ReflectSessionSearchHit[]>('reflect_search_sessions', { query, limit });
}
