/**
 * Schedule (cron) 封装 —— Phase 1 第 2 项。
 *
 * 对应 `src-tauri/src/commands/schedule.rs`(其内部封装
 * `zhuye-agent/crates/integrations/reflect-stream::cron::CronScheduler`)。payload 直接使用核心 crate 类型
 * 的序列化形态(snake_case,因为 `CronJobSpec` 没有派生
 * `rename_all = "camelCase"`);只有 `ScheduleStatus` 信封使用 camelCase
 * (与 Rust 的 `#[serde(rename_all = "camelCase")]` 保持一致)。
 *
 * 生命周期:调度器启动时为空;`install_agent_thread` 会注入真正的
 * `AgentThread::submission_sender()` 并启动一个 30s 的驱动 tick。在安装
 * 完成前,CRUD 返回调度器尚未就绪的错误。驱动触发
 * 到期的 job 时,把其 `prompt` 以 `Submission::user_input` 注入 agent 循环。
 *
 * 暂不在范围内(后续轮次):`run_now`(需要 核心 crate 提供 `pub async fn
 * run_now(&self)`)、持久化(核心 crate 调度器为内存态)、tick 间隔配置、
 * 一次性 `run_at`。
 */
import { invoke } from '../bridge';

// ── CronJobSpec(对应 `reflect_stream::cron::CronJobSpec`,snake_case) ──

export interface ReflectCronJob {
  /** 稳定 uuid,用于 update / remove。 */
  id: string;
  /** 5 段 cron 表达式(min hour dom month dow)。 */
  schedule: string;
  /** job 触发时作为 `Submission::user_input` 注入的 prompt。 */
  prompt: string;
  /** 可选的人类可读名称;缺省时取 prompt 的前 24 个字符。 */
  name?: string | null;
  /** 禁用的 job 仍保留在列表中,但驱动不会触发。 */
  enabled: boolean;
  /** 创建时间(UTC,ISO 8601)。 */
  created_at: string;
  /** 最近触发时间; `null` 表示尚未触发。 */
  last_fired?: string | null;
  /** 计算出的下次触发时间;表达式无解时为 `null`。 */
  next_fire?: string | null;
}

// ── ScheduleStatus(camelCase,对应 `commands/schedule.rs::ScheduleStatus`) ─

export interface ReflectScheduleStatus {
  /** `idle` = 无启用中的 job;`has_jobs` = 至少有一个启用中的 job。 */
  status: 'idle' | 'has_jobs';
  /** 状态徽标使用的一句话。 */
  line: string;
  /** job 总数。 */
  total: number;
  /** 启用的 job 数。 */
  enabled: number;
}

// ── Commands ───────────────────────────────────────────────────────────

/** 列出所有 cron job(按 created_at 升序)。 */
export async function reflect_list_schedules(): Promise<ReflectCronJob[]> {
  return invoke<ReflectCronJob[]>('reflect_list_schedules');
}

/**
 * 注册一个新 job。会校验 5 段 cron 表达式,解析失败时抛错。
 * 未传入 `name` 时,默认取 `prompt` 的前 24 个字符。
 */
export async function reflect_add_schedule(args: {
  schedule: string;
  prompt: string;
  name?: string | null;
}): Promise<ReflectCronJob> {
  return invoke<ReflectCronJob>('reflect_add_schedule', {
    schedule: args.schedule,
    prompt: args.prompt,
    name: args.name ?? null,
  });
}

/**
 * 按 id 更新 job。仅传入需要修改的字段;修改 `schedule` 会重算
 * `next_fire`。id 未找到或新 schedule 解析失败时抛错。
 */
export async function reflect_update_schedule(args: {
  id: string;
  schedule?: string;
  prompt?: string;
  name?: string;
  enabled?: boolean;
}): Promise<ReflectCronJob> {
  return invoke<ReflectCronJob>('reflect_update_schedule', {
    id: args.id,
    schedule: args.schedule ?? null,
    prompt: args.prompt ?? null,
    name: args.name ?? null,
    enabled: args.enabled ?? null,
  });
}

/** 按 id 删除 job。已删除返回 `true`,id 未找到返回 `false`。 */
export async function reflect_remove_schedule(id: string): Promise<boolean> {
  return invoke<boolean>('reflect_remove_schedule', { id });
}

/** 调度器状态快照(idle / has_jobs + 计数)。 */
export async function reflect_get_schedule_status(): Promise<ReflectScheduleStatus> {
  return invoke<ReflectScheduleStatus>('reflect_get_schedule_status');
}
