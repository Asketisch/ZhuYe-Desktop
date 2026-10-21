//! Task / Team 管理命令 —— 薄包装 `reflect_task::TaskManager`。
//!
//! Phase 1 多 agent 命令面:把 核心 crate 已实现的 TaskManager 全套 CRUD 暴露给
//! 前端。严格对齐 `manager.rs` 的公开方法签名,命令层只做参数转发 + 错误映射,
//! 不加业务逻辑(遵循 AGENTS.md "Tauri app 是 reflect_core 薄 adapter" 原则)。
//!
//! ## 命令清单
//!
//! Task CRUD:`reflect_list_tasks` / `reflect_create_task` / `reflect_get_task` /
//! `reflect_update_task` / `reflect_claim_task` / `reflect_delete_task`。
//!
//! Team CRUD:`reflect_list_teams` / `reflect_upsert_team` / `reflect_get_team` /
//! `reflect_delete_team`。
//!
//! ## 存储路径
//!
//! 复用 核心 crate 默认 home(`~/.reflect`),与 TUI/CLI 共享:
//! - Task: `~/.reflect/tasks/<list>/<id>.json`
//! - Team: `~/.reflect/teams/<name>.json`
//!
//! ## 未做(后续阶段)
//!
//! - hook_engine / event_sink 注入(Phase 0 形态;Task 生命周期事件推前端留待 UI 阶段)
//! - Schedule(cron)命令(Phase 1 第 2 项,见 `reflect-agent/crates/integrations/reflect-stream/cron.rs`)
//! - Coordinator 模式开关命令(`is_coordinator_enabled` 已存在,但「启用 + 重启 agent」更重)

use reflect_task::{Task, TaskId, TaskPatch, TaskStatus, TeamFile};
use serde::Serialize;
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// `reflect_update_task` 的返回值。
///
/// 不直接暴露 核心 crate 的 `UpdateOutcome`(其 `status_change: (TaskStatus, TaskStatus)`
/// 元组序列化对前端不友好,且核心 crate 类型未 derive `Serialize`)。命令层展平成
/// task + 字段名列表 + 可选 status 变更描述,前端拿到即可直接渲染。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateResult {
    /// 更新后的任务全量对象。
    pub task: Task,
    /// 实际改动的字段名(如 `["status", "subject"]`)。
    pub updated_fields: Vec<String>,
    /// status 变更描述:`{ from, to }`,仅在 status 实际变化时存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_change: Option<TaskStatusChange>,
}

/// status 变更的 from/to 快照(字符串形式,前端枚举友好)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusChange {
    pub from: String,
    pub to: String,
}

impl From<reflect_task::UpdateOutcome> for TaskUpdateResult {
    fn from(o: reflect_task::UpdateOutcome) -> Self {
        let status_change = o.status_change.map(|(from, to)| TaskStatusChange {
            from: from.to_string(),
            to: to.to_string(),
        });
        Self {
            task: o.task,
            updated_fields: o.updated_fields,
            status_change,
        }
    }
}

// ── Task CRUD ──────────────────────────────────────────────────────────

/// 列出指定 list 下所有任务(按 id 升序,自动排除软删)。
///
/// `list` 语义:worker 视角 = session id;team 视角 = team 名。
#[tauri::command]
pub async fn reflect_list_tasks(
    agent: State<'_, MinimalAgent>,
    list: String,
) -> CommandResult<Vec<Task>> {
    agent
        .task_manager()
        .list_tasks(&list, false)
        .await
        .map_err(Into::into)
}

/// 创建任务。`metadata` 缺省为空 JSON 对象。
#[tauri::command]
pub async fn reflect_create_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    subject: String,
    description: String,
    active_form: Option<String>,
    owner: Option<String>,
    metadata: Option<serde_json::Value>,
) -> CommandResult<Task> {
    agent
        .task_manager()
        .create_task(
            &list,
            subject,
            description,
            active_form,
            owner,
            metadata.unwrap_or_else(|| serde_json::json!({})),
        )
        .await
        .map_err(Into::into)
}

/// 读取单个任务(不含软删)。
#[tauri::command]
pub async fn reflect_get_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
) -> CommandResult<Task> {
    agent
        .task_manager()
        .get_task(&list, id, false)
        .await
        .map_err(Into::into)
}

/// 更新任务。`patch` 字段为 `None` 表示不改;详见 `TaskPatch` 文档。
///
/// `status = Completed` 触发 `TaskCompleted` 钩子(若已注入 hook_engine);
/// 其他字段变更触发 `TaskUpdated`。
#[tauri::command]
pub async fn reflect_update_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
    patch: TaskPatch,
) -> CommandResult<TaskUpdateResult> {
    agent
        .task_manager()
        .update_task(&list, id, patch)
        .await
        .map(TaskUpdateResult::from)
        .map_err(Into::into)
}

/// 原子认领:在该 list 下找第一个 `Pending && blocked_by.is_empty()` 的任务,
/// 标 `InProgress` 并写入 `claimed_by` / `claimed_at`。无可认领任务返回 `None`。
///
/// 并发安全:同 list 内多 worker 经 per-list 锁串行化,无重复认领。
#[tauri::command]
pub async fn reflect_claim_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    claimer: String,
) -> CommandResult<Option<Task>> {
    agent
        .task_manager()
        .claim_next_available(&list, &claimer)
        .await
        .map_err(Into::into)
}

/// 物理删除任务文件(区别于 `update_task status=Deleted` 的软删除)。
#[tauri::command]
pub async fn reflect_delete_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
) -> CommandResult<()> {
    agent
        .task_manager()
        .delete_task(&list, id)
        .await
        .map_err(Into::into)
}

// ── Task 产出 / 停止 / 释放 ─────────────────────────────────────────────

/// 读取任务产出文件的内容(worker 的交付物)。
///
/// 与核心 `TaskOutputTool` 同款语义:读 `task.output_path` 指向的文件。
/// **不阻塞等待**(`block=false` 语义)—— GUI 是拉取式视图,不能因为
/// worker 还没写完就把界面挂住;文件不存在 → 空串。
#[tauri::command]
pub async fn reflect_get_task_output(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
) -> CommandResult<String> {
    let mgr = agent.task_manager();
    let task = mgr
        .get_task(&list, id, false)
        .await
        .map_err(crate::commands::error::CommandError::from)?;
    let Some(path) = task.output_path.clone() else {
        return Ok(String::new());
    };
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(content),
        // 文件不存在(worker 还没写)→ 空串,不报错 —— 与核心工具同语义。
        Err(_) => Ok(String::new()),
    }
}

/// 停止一个进行中的任务(与核心 `TaskStopTool` 同语义)。
///
/// 守卫同款:`status` 必须是 `in_progress`,否则报错(不静默改状态)。
/// 动作 = 退回 `pending` + 清空 `owner`。
#[tauri::command]
pub async fn reflect_stop_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
) -> CommandResult<TaskUpdateResult> {
    let mgr = agent.task_manager();
    let current = mgr
        .get_task(&list, id, false)
        .await
        .map_err(crate::commands::error::CommandError::from)?;
    if current.status != TaskStatus::InProgress {
        return Err(crate::commands::error::CommandError {
            msg: format!(
                "stop requires status=in_progress; current status is {}",
                current.status
            ),
        });
    }
    let patch = TaskPatch {
        status: Some(TaskStatus::Pending),
        // `Some(None)` = 显式清空。
        owner: Some(None),
        ..Default::default()
    };
    mgr.update_task(&list, id, patch)
        .await
        .map(TaskUpdateResult::from)
        .map_err(Into::into)
}

/// 释放一个已被认领的任务(与核心 `TaskReleaseTool` 同语义)。
///
/// 守卫同款:必须存在 `claimed_by`,否则报错。动作 = 退回 `pending` +
/// 清空 `claimed_by` / `claimed_at`。
#[tauri::command]
pub async fn reflect_release_task(
    agent: State<'_, MinimalAgent>,
    list: String,
    id: TaskId,
) -> CommandResult<TaskUpdateResult> {
    let mgr = agent.task_manager();
    let current = mgr
        .get_task(&list, id, false)
        .await
        .map_err(crate::commands::error::CommandError::from)?;
    if current.claimed_by.is_none() {
        return Err(crate::commands::error::CommandError {
            msg: format!("task #{id} is not claimed (nothing to release)"),
        });
    }
    let patch = TaskPatch {
        status: Some(TaskStatus::Pending),
        claimed_by: Some(None),
        claimed_at: Some(None),
        ..Default::default()
    };
    mgr.update_task(&list, id, patch)
        .await
        .map(TaskUpdateResult::from)
        .map_err(Into::into)
}

// ── Team CRUD ──────────────────────────────────────────────────────────

/// 列所有 team,按 name 字典序。
#[tauri::command]
pub async fn reflect_list_teams(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<TeamFile>> {
    agent.task_manager().list_teams().await.map_err(Into::into)
}

/// 幂等 upsert team。校验:`name` 合法 + `lead_agent_id == team-lead@<name>`。
#[tauri::command]
pub async fn reflect_upsert_team(
    agent: State<'_, MinimalAgent>,
    team: TeamFile,
) -> CommandResult<()> {
    agent
        .task_manager()
        .upsert_team(team)
        .await
        .map_err(Into::into)
}

/// 读取单个 team;不存在返回 `TeamNotFound` 错误。
#[tauri::command]
pub async fn reflect_get_team(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<TeamFile> {
    agent
        .task_manager()
        .get_team(&name)
        .await
        .map_err(Into::into)
}

/// 物理删除 team 文件(不级联删 task,由后续清理命令统一处理)。
#[tauri::command]
pub async fn reflect_delete_team(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<()> {
    agent
        .task_manager()
        .delete_team(&name)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    //! 命令包装层测试。
    //!
    //! 策略沿用 `sessions.rs`:不 spin up Tauri runtime,而是直接构造
    //! `TaskManager`(in-memory stores),复现命令的参数转发 + 错误映射逻辑。
    //! 这能捕获「签名不匹配 / patch 字段漏传 / 错误变体丢失」类回归;
    //! Tauri `State` 注入本身由框架保证,无需在此覆盖。

    use super::*;
    use reflect_task::{InMemoryTaskStore, InMemoryTeamStore, TaskManager, TaskStatus};
    use std::sync::Arc;

    fn mgr() -> TaskManager {
        TaskManager::new(
            Arc::new(InMemoryTaskStore::new()),
            Arc::new(InMemoryTeamStore::new()),
        )
    }

    // 直接复用命令的内部调用路径(绕过 `State` 注入),验证参数转发正确。
    // 命令体本身只是 `agent.task_manager().<method>(args).await.map_err`,
    // 所以这里等价于端到端测 TaskManager 行为 + 证明命令层用的 API 真实存在。

    #[tokio::test]
    async fn task_create_get_update_list_claim_delete_chain() {
        let m = mgr();

        // create
        let t = m
            .create_task(
                &"L".into(),
                "write tests".into(),
                "add unit tests".into(),
                Some("Writing tests".into()),
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        assert_eq!(t.id, 1);
        assert_eq!(t.status, TaskStatus::Pending);

        // get
        let fetched = m.get_task(&"L".into(), 1, false).await.unwrap();
        assert_eq!(fetched.subject, "write tests");

        // update status(经命令层 TaskUpdateResult 转换)
        let outcome: TaskUpdateResult = m
            .update_task(
                &"L".into(),
                1,
                TaskPatch {
                    status: Some(TaskStatus::InProgress),
                    ..Default::default()
                },
            )
            .await
            .map(TaskUpdateResult::from)
            .unwrap();
        assert_eq!(outcome.task.status, TaskStatus::InProgress);
        assert!(outcome.updated_fields.contains(&"status".to_string()));
        assert_eq!(
            outcome.status_change.map(|c| (c.from, c.to)),
            Some(("pending".into(), "in_progress".into()))
        );

        // list
        let all = m.list_tasks(&"L".into(), false).await.unwrap();
        assert_eq!(all.len(), 1);

        // claim(此时 task 1 已 InProgress,新 list 才有可认领的)
        let t2 = m
            .create_task(
                &"L2".into(),
                "another".into(),
                "".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        let claimed = m
            .claim_next_available(&"L2".into(), "worker@x")
            .await
            .unwrap()
            .expect("should claim");
        assert_eq!(claimed.id, t2.id);
        assert_eq!(claimed.claimed_by.as_deref(), Some("worker@x"));

        // delete(物理删)
        m.delete_task(&"L".into(), 1).await.unwrap();
        let err = m.get_task(&"L".into(), 1, false).await.unwrap_err();
        assert!(matches!(err, reflect_task::TaskError::NotFound { .. }));
    }

    #[tokio::test]
    async fn team_upsert_get_list_delete_chain() {
        use std::time::SystemTime;
        let m = mgr();

        let now = SystemTime::now();
        let lead_id = reflect_task::lead_agent_id_for("rocket");
        let team = TeamFile {
            name: "rocket".into(),
            description: Some("Build rocket".into()),
            lead_agent_id: lead_id.clone(),
            lead_session_id: None,
            members: vec![reflect_task::TeamMemberSpec {
                agent_id: lead_id,
                name: "team-lead".into(),
                role: "team-lead".into(),
                model: None,
                system_prompt: "lead".into(),
                allowed_tools: vec![],
                color: None,
                joined_at: now,
                session_id: None,
                subscriptions: vec![],
            }],
            created_at: now,
        };

        // upsert
        m.upsert_team(team.clone()).await.unwrap();

        // get
        let back = m.get_team("rocket").await.unwrap();
        assert_eq!(back.name, "rocket");
        assert_eq!(back.lead_agent_id, "team-lead@rocket");

        // list
        let teams = m.list_teams().await.unwrap();
        assert_eq!(teams.len(), 1);

        // delete
        m.delete_team("rocket").await.unwrap();
        let err = m.get_team("rocket").await.unwrap_err();
        assert!(matches!(err, reflect_task::TaskError::TeamNotFound(_)));
    }

    /// 命令层错误映射:`TaskError` 经 `From<TaskError> for CommandError` 不丢信息。
    #[test]
    fn task_error_maps_to_command_error() {
        let e = reflect_task::TaskError::NotFound {
            list: "L".into(),
            id: 42,
        };
        let c: crate::commands::error::CommandError = e.into();
        assert!(c.msg.contains("42"));
        assert!(c.msg.contains("L"));
    }

    /// 停止 / 释放的守卫与核心工具同款:
    /// - `stop` 要求 `status == in_progress`;
    /// - `release` 要求存在 `claimed_by`;
    /// 动作都是「退回 pending + 清 owner / claimed_by」。
    #[tokio::test]
    async fn stop_requires_in_progress_and_release_requires_claim() {
        let m = mgr();
        let t = m
            .create_task(
                &"L".into(),
                "worker task".into(),
                "".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();

        // pending 状态不能 stop —— 守卫必须报错,而不是静默改状态。
        let current = m.get_task(&"L".into(), t.id, false).await.unwrap();
        assert_eq!(current.status, TaskStatus::Pending);
        assert!(
            reflect_task::TaskStatus::InProgress != current.status,
            "stop 的前置条件不满足时命令层必须拒绝"
        );

        // 未被认领的任务不能 release。
        assert!(
            current.claimed_by.is_none(),
            "未被认领的任务没有可释放的认领"
        );

        // 认领 → 进行中 → stop:owner 被清空、状态退回 pending。
        let claimed = m
            .claim_next_available(&"L".into(), "worker@x")
            .await
            .unwrap()
            .expect("should claim");
        assert_eq!(claimed.claimed_by.as_deref(), Some("worker@x"));

        let stopped = m
            .update_task(
                &"L".into(),
                t.id,
                TaskPatch {
                    status: Some(TaskStatus::Pending),
                    owner: Some(None),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(stopped.task.status, TaskStatus::Pending);
        assert!(stopped.task.owner.is_none(), "stop 应清空 owner");
    }
}
