/**
 * Session I/O —— 列表 / 回放 / 重命名 / 删除 / 归档 / 导出。
 *
 * `ZhuyeRolloutRecord` 故意采用 `Record<string, unknown>` 形态,
 * 因为 Rust 端返回的是按协议判别的联合类型;TS 视图见
 * `src/types/protocol.ts`。
 */
import { invoke } from '../../bridge';
import { waitForWorkspaceSwitches } from './workspaces';
import type { ZhuyeRolloutRecord, ZhuyeSessionInfo } from '../../types';
import type { PendingGateSnapshot } from '@/types/protocol';
import type { PromptSelection } from '../knowledge/prompts';

/** `zhuye_list_sessions` 返回的 session 元数据。 */
export type { ZhuyeSessionInfo } from '../../types';

/** `zhuye_export_session_markdown` 的返回结果。 */
export interface ZhuyeMarkdownExportResult {
  path: string;
  bytes: number;
}

/**
 * 分页获取会话列表。`limit` 与 `offset` 均可选。
 *
 * `workspace` 为当前工作区绝对路径时只返回归属该工作区的会话;
 * `null` / 省略 → 全量(含未归属旧会话)。
 */
export async function zhuye_list_sessions(
  opts: { workspace?: string | null; limit?: number; offset?: number } = {},
): Promise<ZhuyeSessionInfo[]> {
  return invoke<ZhuyeSessionInfo[]>('zhuye_list_sessions', {
    workspace: opts.workspace ?? null,
    limit: opts.limit ?? null,
    offset: opts.offset ?? null,
  });
}

/** 预分配一个新会话 id(前端路由用)。workspace 归属由首条提交携带。 */
export async function zhuye_create_session(): Promise<string> {
  return invoke<string>('zhuye_create_session');
}

/**
 * 把后端 AgentThread 绑到指定 session id(ChatView 挂载时调用)。
 *
 * 后端幂等:同 id 二次 bind 直接短路。未知 id(磁盘无对应 JSONL,
 * 如刚由 `zhuye_create_session` 分配)走空历史分支,不报错。
 *
 * 返回绑定后线程的当前 PermissionMode(线格式字符串)。历史会话的
 * 模式从 JSONL 审计轨迹恢复(绑定会话而非进程),前端据此同步
 * 权限模式徽标/切换器。
 */
let bindQueue: Promise<void> = Promise.resolve();

/**
 * v1.12:`zhuye_bind_session` 的返回结构(有意协议扩展:命令名不变,
 * 由单一 mode 字符串改为结构体)。
 */
export interface BindSessionOutput {
  /** 绑定后线程的当前 PermissionMode(线格式字符串,如 `"plan"`)。 */
  permission_mode: string;
  /** 引擎侧挂起交互快照(审批/问答/询问/plan),reload/换绑重水合数据源。 */
  pending_gates: PendingGateSnapshot[];
  /**
   * v1.13:该会话的提示词选择 override(权威值;`null` = 跟随全局默认)。
   *
   * 前端据此判定切会话后是否真的需要下发 Select —— 相同则不发,
   * 既不写冗余 rollout 记录,也不弹「提示词已刷新」。
   */
  prompt_selection: PromptSelection | null;
}

export function zhuye_bind_session(id: string): Promise<BindSessionOutput> {
  const result = bindQueue.then(async () => {
    await waitForWorkspaceSwitches();
    return invoke<BindSessionOutput>('zhuye_bind_session', { id });
  });
  bindQueue = result.then(() => {}, () => {});
  return result;
}

/** 按 id 重命名已有会话。 */
export async function zhuye_rename_session(id: string, new_name: string): Promise<void> {
  return invoke<void>('zhuye_rename_session', { id, newName: new_name });
}

/**
 * 基于历史会话 fork 出子会话（CLI `zhuye session fork` 的 GUI 入口）。
 *
 * 后端复制父会话 JSONL（`up_to_turn_id` 可选截至某 turn，含）生成新
 * session id，父文件写 Fork 血缘 marker，并把 `branch` 写成子会话的
 * 自定义名。返回子会话 id —— 调用方自行路由切换（ChatView 挂载时
 * bind + replay 即得完整历史）。
 */
export async function zhuye_fork_session(
  id: string,
  branch?: string,
  up_to_turn_id?: string,
): Promise<string> {
  return invoke<string>('zhuye_fork_session', {
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
export async function zhuye_generate_session_title(id: string, force = false): Promise<string> {
  return invoke<string>('zhuye_generate_session_title', { id, force });
}

/** 按 id 删除已有会话。 */
export async function zhuye_delete_session(id: string): Promise<void> {
  return invoke<void>('zhuye_delete_session', { id });
}

/** 按 id 归档会话（文件移出 sessions 树，列表/回放不再命中）。 */
export async function zhuye_archive_session(id: string): Promise<void> {
  return invoke<void>('zhuye_archive_session', { id });
}

/** 按 id 恢复已归档会话（沿原相对路径搬回）。 */
export async function zhuye_unarchive_session(id: string): Promise<void> {
  return invoke<void>('zhuye_unarchive_session', { id });
}

/**
 * 列出已归档会话。`workspace` 过滤语义与 `zhuye_list_sessions` 一致。
 */
export async function zhuye_list_archived_sessions(
  workspace?: string | null,
): Promise<ZhuyeSessionInfo[]> {
  return invoke<ZhuyeSessionInfo[]>('zhuye_list_archived_sessions', {
    workspace: workspace ?? null,
  });
}

/** 回放会话:返回原始事件所产生的 rollout record 流。 */
export async function zhuye_replay_session(id: string): Promise<ZhuyeRolloutRecord[]> {
  return invoke<ZhuyeRolloutRecord[]>('zhuye_replay_session', { id });
}

/** 将会话导出为 JSON,返回绝对路径。 */
export async function zhuye_export_session(id: string): Promise<string | null> {
  return invoke<string | null>('zhuye_export_session', { id });
}

/** 将会话导出为 Markdown,返回渲染后的文件路径。 */
export async function zhuye_export_session_markdown(
  id: string,
): Promise<ZhuyeMarkdownExportResult | null> {
  return invoke<ZhuyeMarkdownExportResult | null>('zhuye_export_session_markdown', { id });
}

/** 跨会话内容搜索命中（后端 grep 会话 JSONL 的 user/assistant 文本）。 */
export interface ZhuyeSessionSearchHit {
  session_id: string;
  title: string | null;
  /** 首个命中片段（前后 ~60 字符，空白已折叠）。 */
  snippet: string;
  started_at: string;
  message_count: number;
  match_count: number;
}

/** 跨会话全文搜索（大小写不敏感；覆盖活跃树 + 归档树，最近 120 个会话）。 */
export async function zhuye_search_sessions(query: string, limit?: number): Promise<ZhuyeSessionSearchHit[]> {
  return invoke<ZhuyeSessionSearchHit[]>('zhuye_search_sessions', { query, limit });
}
