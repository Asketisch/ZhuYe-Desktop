//! Activity timeline 命令面。
//!
//! 薄包装 `reflect_app_core::activity::ActivityLog`(上游
//! `reflect_telemetry::activity` 的共享句柄),供前端 Inbox /
//! Activity timeline / @mention 搜索消费。上游实现已收编为单一事实源,
//! 这里不再有独立错误类型(`list` / `search_mentions` 无失败态)。

use reflect_app_core::activity::{ActivityEvent, ActivityFilter};
use serde::Deserialize;
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

/// IPC 入参 DTO:上游 `ActivityFilter` 是纯查询结构(无 serde 派生),
/// camelCase 出线由这里承接后转换。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActivityFilterInput {
    kind: Option<ActivityEventKind>,
    level: Option<reflect_app_core::activity::ActivityLevel>,
    actor_id: Option<String>,
    team_name: Option<String>,
    since_ms: Option<u64>,
    limit: Option<usize>,
}

// 上游 ActivityKind 就是 serde 枚举,直接复用其 Deserialize。
type ActivityEventKind = reflect_app_core::activity::ActivityKind;

impl From<ActivityFilterInput> for ActivityFilter {
    fn from(input: ActivityFilterInput) -> Self {
        ActivityFilter {
            kind: input.kind,
            level: input.level,
            actor_id: input.actor_id,
            team_name: input.team_name,
            since_ms: input.since_ms,
            limit: input.limit,
        }
    }
}

/// 列出 activity 事件(按过滤条件)。
#[tauri::command]
pub async fn reflect_list_activity(
    agent: State<'_, MinimalAgent>,
    filter: Option<ActivityFilterInput>,
) -> CommandResult<Vec<ActivityEvent>> {
    let f = filter.map(ActivityFilter::from).unwrap_or_default();
    Ok(agent.activity_log().get().list(&f))
}

/// 搜索 mention(`@<query>` 出现在 summary 或 actorId 里)。
#[tauri::command]
pub async fn reflect_search_activity(
    agent: State<'_, MinimalAgent>,
    query: String,
) -> CommandResult<Vec<ActivityEvent>> {
    Ok(agent.activity_log().get().search_mentions(&query))
}

/// 清空内存 activity 缓冲(磁盘审计文件不动)。
#[tauri::command]
pub async fn reflect_clear_activity(agent: State<'_, MinimalAgent>) -> CommandResult<()> {
    agent.activity_log().clear_memory();
    Ok(())
}

/// 测试辅助:当前内存缓冲事件数(诊断用)。
#[tauri::command]
pub async fn reflect_activity_count(agent: State<'_, MinimalAgent>) -> CommandResult<usize> {
    Ok(agent.activity_log().len())
}
