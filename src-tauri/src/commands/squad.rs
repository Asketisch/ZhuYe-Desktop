//! Squad + Leader 委派命令面。
//!
//! 薄包装 `reflect_task::SquadManager`,在 TaskManager 之上提供
//! leader 委派语义层。

use reflect_task::Task;
use reflect_task::{SquadError, SquadSpec};
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

impl From<SquadError> for super::error::CommandError {
    fn from(e: SquadError) -> Self {
        super::error::CommandError { msg: e.to_string() }
    }
}

/// 列出所有 squad。
#[tauri::command]
pub async fn reflect_list_squads(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<SquadSpec>> {
    Ok(agent.squad_manager().list_squads().await?)
}

/// 创建 / 覆盖一个 squad。
#[tauri::command]
pub async fn reflect_create_squad(
    agent: State<'_, MinimalAgent>,
    spec: SquadSpec,
) -> CommandResult<()> {
    agent.squad_manager().create_squad(spec).await?;
    Ok(())
}

/// 读取单个 squad。
#[tauri::command]
pub async fn reflect_get_squad(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<SquadSpec> {
    Ok(agent.squad_manager().get_squad(&name).await?)
}

/// 删除 squad(team 文件物理删除;task 不级联)。
#[tauri::command]
pub async fn reflect_delete_squad(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<()> {
    agent.squad_manager().delete_squad(&name).await?;
    Ok(())
}

/// leader 原子认领下一个 Pending+unblocked 任务。
#[tauri::command]
pub async fn reflect_delegate_next(
    agent: State<'_, MinimalAgent>,
    name: String,
    leader_actor_id: String,
) -> CommandResult<Option<Task>> {
    Ok(agent
        .squad_manager()
        .delegate_next(&name, &leader_actor_id)
        .await?)
}

/// 把任务分配给具体成员(`assignee` 为 None 清空分配)。
#[tauri::command]
pub async fn reflect_assign_squad_task(
    agent: State<'_, MinimalAgent>,
    name: String,
    task_id: u32,
    assignee: Option<String>,
) -> CommandResult<Task> {
    Ok(agent
        .squad_manager()
        .assign_task(&name, task_id, assignee)
        .await?)
}
