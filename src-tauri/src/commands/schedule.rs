//! Schedule(cron)管理命令 —— 薄包装 `reflect_stream::cron::CronScheduler`。
//!
//! Phase 1 第 2 项:把 核心 crate 已实现的 CronScheduler CRUD 暴露给前端。严格
//! 对齐 `cron.rs` 的公开方法签名,命令层只做参数转发 + 错误映射。
//!
//! ## 命令清单
//!
//! - `reflect_list_schedules` — 列出当前所有 cron job(按 created_at 排序)
//! - `reflect_add_schedule` — 注册新 job(校验 cron 表达式)
//! - `reflect_update_schedule` — 更新 job(schedule/prompt/name/enabled 任一)
//! - `reflect_remove_schedule` — 删除 job
//! - `reflect_get_schedule_status` — 调度器状态(Idle / HasJobs)+ 人可读状态行
//!
//! ## 调度器生命周期
//!
//! `MinimalAgentInner.cron_scheduler` 初始为 `None`;`install_agent_thread`
//! 注入真 `AgentThread::submission_sender()` 后,driver(30s tick)启动,到
//! 期 job 的 prompt 作为 `Submission::user_input` 注入 agent loop。在 install
//! 完成前,CRUD 返回调度器尚未就绪的错误。
//!
//! ## 未做(后续阶段)
//!
//! - `run_now`(立即触发):核心 crate `CronScheduler::tick` 需访问私有 jobs Arc,
//!   命令层无法复用;待 核心 crate 加公开 `pub async fn run_now(&self)` 后补。
//! - 持久化由 `state.rs` 接到 `<data>/cron/schedules.json`;重启后保留
//!   job,并为启用任务从当前时间重算下次触发。
//! - 后台 driver tick 间隔配置。
//! - 一次性 schedule(`run_at` 时间点)。

use reflect_stream::cron::{CronJobSpec, CronSchedule, CronScheduler, CronStatus};
use serde::Serialize;
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// `reflect_get_schedule_status` 的返回值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleStatus {
    /// `idle` = 无 enabled job;`has_jobs` = 至少一个 enabled job。
    pub status: String,
    /// 人可读状态行(给前端 status badge 用)。
    pub line: String,
    /// job 总数。
    pub total: usize,
    /// enabled job 数。
    pub enabled: usize,
}

/// 取当前 scheduler;未 install 时返回友好错误(命令层不可用)。
fn scheduler(agent: &State<'_, MinimalAgent>) -> CommandResult<CronScheduler> {
    agent.cron_scheduler().ok_or_else(|| CommandError {
        msg: "cron scheduler not ready — agent still installing".into(),
    })
}

/// 列出所有 cron job(按 created_at 升序)。
#[tauri::command]
pub async fn reflect_list_schedules(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<CronJobSpec>> {
    Ok(scheduler(&agent)?.list())
}

/// 注册新 job。校验 5 字段 cron 表达式,失败返回 `CronParseError`。
/// `name` 缺省时由 prompt 前 24 字符派生。
#[tauri::command]
pub async fn reflect_add_schedule(
    agent: State<'_, MinimalAgent>,
    schedule: String,
    prompt: String,
    name: Option<String>,
) -> CommandResult<CronJobSpec> {
    scheduler(&agent)?
        .create(&schedule, prompt, name)
        .map_err(CommandError::from)
}

/// 更新 job(按 id)。`schedule` / `prompt` / `name` / `enabled` 任一为
/// `Some` 才更新;改 schedule 会重算 next_fire。id 不存在返回错误。
#[tauri::command]
pub async fn reflect_update_schedule(
    agent: State<'_, MinimalAgent>,
    id: String,
    schedule: Option<String>,
    prompt: Option<String>,
    name: Option<String>,
    enabled: Option<bool>,
) -> CommandResult<CronJobSpec> {
    let s = scheduler(&agent)?;
    if s.get(&id).is_none() {
        return Err(CommandError {
            msg: format!("schedule not found: {id}"),
        });
    }
    if let Some(expression) = schedule.as_deref() {
        CronSchedule::parse(expression).map_err(CommandError::from)?;
    }
    let updated = s.update(
        &id,
        schedule.as_deref(),
        prompt.as_deref(),
        name.as_deref(),
        enabled,
    );
    match updated {
        Some(job) => Ok(job),
        None => Err(CommandError {
            msg: format!("schedule not found: {id}"),
        }),
    }
}

/// 删除 job(按 id)。返回是否删除成功(false = id 不存在)。
#[tauri::command]
pub async fn reflect_remove_schedule(
    agent: State<'_, MinimalAgent>,
    id: String,
) -> CommandResult<bool> {
    Ok(scheduler(&agent)?.delete(&id))
}

/// 调度器状态快照。
#[tauri::command]
pub async fn reflect_get_schedule_status(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<ScheduleStatus> {
    let s = scheduler(&agent)?;
    let total = s.list().len();
    let enabled = s.list().iter().filter(|j| j.enabled).count();
    Ok(ScheduleStatus {
        status: match s.status() {
            CronStatus::Idle => "idle".into(),
            CronStatus::HasJobs => "has_jobs".into(),
        },
        line: s.status_line(),
        total,
        enabled,
    })
}

#[cfg(test)]
mod tests {
    //! 命令包装层测试。沿用 sessions.rs / tasks.rs 策略:不 spin Tauri runtime,
    //! 直接测 CronScheduler 行为,证明命令层 API 真实存在 + 参数转发正确。

    use reflect_protocol::ThreadId;
    use reflect_stream::cron::{CronScheduler, CronStatus};

    fn sched() -> CronScheduler {
        CronScheduler::new(None, ThreadId::new())
    }

    #[tokio::test]
    async fn create_list_update_delete_chain() {
        let s = sched();

        // create
        let job = s
            .create("0 * * * *", "standup", Some("daily".into()))
            .unwrap();
        assert!(job.next_fire.is_some());
        assert_eq!(s.list().len(), 1);
        assert_eq!(s.status(), CronStatus::HasJobs);

        // 更新 enabled=false
        let updated = s.update(&job.id, None, None, None, Some(false)).unwrap();
        assert!(!updated.enabled);
        assert_eq!(s.status(), CronStatus::Idle);

        // delete
        assert!(s.delete(&job.id));
        assert!(s.get(&job.id).is_none());
    }

    #[tokio::test]
    async fn create_rejects_bad_schedule() {
        let s = sched();
        assert!(s.create("not-a-cron", "x", None).is_err());
        assert_eq!(s.list().len(), 0);
    }

    /// `CronParseError` 经 `From` 映射到 `CommandError` 不丢信息。
    #[test]
    fn parse_error_maps_to_command_error() {
        let e = reflect_stream::cron::CronSchedule::parse("bad").unwrap_err();
        let c: crate::commands::error::CommandError = e.into();
        assert!(!c.msg.is_empty());
    }
}
