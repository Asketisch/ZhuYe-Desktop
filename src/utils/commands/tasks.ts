/**
 * Task 管理封装 —— Phase 1 多 agent 命令面。
 *
 * 对应 `src-tauri/src/commands/tasks.rs` 的 Task 部分(其内部封装
 * `reflect-agent/crates/orchestration/reflect-task::TaskManager`)。Team 封装并列存放在 `./teams.ts`。
 * Task payload 直接使用核心 crate 类型的序列化形态(snake_case,因为 `Task`
 * 没有派生 `rename_all = "camelCase"`);只有 `TaskUpdateResult` 信封采用
 * camelCase(见 `commands/tasks.rs`)。
 *
 * 存储复用:数据位于 `~/.reflect/tasks/<list>/<id>.json`,与 TUI/CLI 共享。
 */
import { invoke } from '../bridge';

// ── Task 状态(snake_case,对应 `reflect_task::TaskStatus`) ──────────────

export type ReflectTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

// ── Task(对应 `reflect_task::Task`,snake_case) ────────────────────────

export interface ReflectTask {
  id: number;
  list_id: string;
  subject: string;
  description: string;
  active_form?: string | null;
  owner?: string | null;
  status: ReflectTaskStatus;
  /** 该 task 阻塞的下游 task id 列表。 */
  blocks: number[];
  /** 该 task 启动前必须完成的上游 task id 列表。 */
  blocked_by: number[];
  metadata: Record<string, unknown>;
  output_path?: string | null;
  /** 原子认领该 task 的 worker id(`<role>@<team>` 或 session id)。 */
  claimed_by?: string | null;
  claimed_at?: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

// ── TaskPatch(对应 `reflect_task::TaskPatch`) ──────────────────────────
//
// 所有字段均可选,只传入需要修改的字段。
// `Some("")` 表示清空字符串字段;`undefined`(不传)则保持原值。
// `active_form` / `owner` / `claimed_by` / `claimed_at` 中的 `null` 表示
// "清空",与 Rust 的 `Option<Option<T>>` 三态语义保持一致。

export interface ReflectTaskPatch {
  subject?: string;
  description?: string;
  active_form?: string | null;
  owner?: string | null;
  status?: ReflectTaskStatus;
  metadata?: Record<string, unknown>;
  /** 追加该 task 阻塞的下游 task id(去重)。 */
  add_blocks?: number[];
  /** 追加阻塞该 task 的上游 task id(去重)。 */
  add_blocked_by?: number[];
  /** `string` = 设置,`null` = 清空,`undefined` = 保持原值。 */
  claimed_by?: string | null;
  claimed_at?: number | string | null;
}

// ── TaskUpdateResult(camelCase,对应 `commands/tasks.rs::TaskUpdateResult`) ─

export interface ReflectTaskStatusChange {
  from: string;
  to: string;
}

export interface ReflectTaskUpdateResult {
  /** 更新后的完整 task 对象。 */
  task: ReflectTask;
  /** 实际发生变更的字段名(例如 `["status", "subject"]`)。 */
  updatedFields: string[];
  /** 仅当 `status` 实际发生变更时出现。 */
  statusChange?: ReflectTaskStatusChange;
}

// ── Commands ───────────────────────────────────────────────────────────

/** 列出指定 list 下的 tasks(worker 视图 = session id;team 视图 = team 名)。 */
export async function reflect_list_tasks(list: string): Promise<ReflectTask[]> {
  return invoke<ReflectTask[]>('reflect_list_tasks', { list });
}

/** 创建一个 task。`metadata` 默认 `{}`。 */
export async function reflect_create_task(args: {
  list: string;
  subject: string;
  description: string;
  active_form?: string | null;
  owner?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ReflectTask> {
  return invoke<ReflectTask>('reflect_create_task', {
    list: args.list,
    subject: args.subject,
    description: args.description,
    // Tauri 2 平铺参数按 camelCase 匹配（Rust `active_form` → JS `activeForm`）;
    // 传 snake_case 会被静默丢弃（Option 参数缺键 → None）。
    activeForm: args.active_form ?? null,
    owner: args.owner ?? null,
    metadata: args.metadata ?? null,
  });
}

/** 读取单个 task(不包含软删除的)。 */
export async function reflect_get_task(list: string, id: number): Promise<ReflectTask> {
  return invoke<ReflectTask>('reflect_get_task', { list, id });
}

/**
 * 读取任务产出文件的内容(worker 的交付物)。
 *
 * 与核心 `TaskOutputTool` 同款语义:读 `task.output_path` 指向的文件。
 * **不阻塞** —— 产出还没写好时返回空串(不报错),GUI 是拉取式视图。
 */
export async function reflect_get_task_output(
  list: string,
  id: number,
): Promise<string> {
  return invoke<string>('reflect_get_task_output', { list, id });
}

/**
 * 停止一个进行中的 task(与核心 `TaskStopTool` 同语义)。
 *
 * 守卫:状态必须是 `in_progress`,否则后端报错。动作 = 退回 `pending` +
 * 清空 owner。
 */
export async function reflect_stop_task(
  list: string,
  id: number,
): Promise<ReflectTaskUpdateResult> {
  return invoke<ReflectTaskUpdateResult>('reflect_stop_task', { list, id });
}

/**
 * 释放一个已被认领的 task(与核心 `TaskReleaseTool` 同语义)。
 *
 * 守卫:必须存在 `claimed_by`,否则后端报错。动作 = 退回 `pending` +
 * 清空 `claimed_by` / `claimed_at`。
 */
export async function reflect_release_task(
  list: string,
  id: number,
): Promise<ReflectTaskUpdateResult> {
  return invoke<ReflectTaskUpdateResult>('reflect_release_task', { list, id });
}

/**
 * 更新 task。仅传入需要修改的字段。
 * `status = "completed"` 会触发 `TaskCompleted` hook(在 hook engine 接入后);
 * 其他变更触发 `TaskUpdated`。
 */
export async function reflect_update_task(
  list: string,
  id: number,
  patch: ReflectTaskPatch,
): Promise<ReflectTaskUpdateResult> {
  return invoke<ReflectTaskUpdateResult>('reflect_update_task', { list, id, patch });
}

/**
 * 原子认领 list 中下一个可用的 task:第一个 `pending` 且 `blocked_by` 为空的 task。
 * 无可认领时返回 `null`。同一 list 下的并发 worker 串行化,不会出现重复认领。
 */
export async function reflect_claim_task(
  list: string,
  claimer: string,
): Promise<ReflectTask | null> {
  return invoke<ReflectTask | null>('reflect_claim_task', { list, claimer });
}

/** 物理删除 task 文件(区别于 `update_task({ status: "deleted" })` 的软删除)。 */
export async function reflect_delete_task(list: string, id: number): Promise<void> {
  return invoke<void>('reflect_delete_task', { list, id });
}
