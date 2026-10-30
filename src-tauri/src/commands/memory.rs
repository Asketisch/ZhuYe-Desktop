//! Memory 增删查命令。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

#[derive(Debug, Serialize)]
pub struct MemoryEntry {
    pub scope: String, // "project" | "user"
    pub key: String,
    pub value: String,
    #[serde(rename = "wholeDocument", skip_serializing_if = "Option::is_none")]
    pub whole_document: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MemoryContext {
    workspace: String,
    agent: String,
}

pub(crate) fn validate_context(
    agent: &MinimalAgent,
    expected: Option<&MemoryContext>,
) -> CommandResult<()> {
    if let Some(expected) = expected {
        if !crate::workspace_state::same_path(
            std::path::Path::new(&expected.workspace),
            &agent.workspace(),
        ) || expected.agent != crate::agent_state::AgentState::active_agent()
        {
            return Err("memory workspace or active agent changed; reload and retry".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reflect_list_memory(
    agent: State<'_, MinimalAgent>,
    expected_context: Option<MemoryContext>,
) -> CommandResult<Vec<MemoryEntry>> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    validate_context(&agent, expected_context.as_ref())?;
    let _memory = agent.inner.memory_write_lock.lock().await;
    agent
        .list_memory()
        .map_err(crate::commands::error::CommandError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // 保持既有平铺 IPC 负载，新增字段均为可选项。
pub async fn reflect_add_memory(
    agent: State<'_, MinimalAgent>,
    scope: String,
    key: String,
    value: String,
    replace_document: Option<bool>,
    create_only: Option<bool>,
    expected_context: Option<MemoryContext>,
    expected_value: Option<String>,
) -> CommandResult<()> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    validate_context(&agent, expected_context.as_ref())?;
    let _memory = agent.inner.memory_write_lock.lock().await;
    agent
        .add_memory(
            scope,
            key,
            value,
            replace_document.unwrap_or(false),
            create_only.unwrap_or(false),
            expected_value,
        )
        .map_err(crate::commands::error::CommandError::from)
}

#[tauri::command]
pub async fn reflect_remove_memory(
    agent: State<'_, MinimalAgent>,
    scope: String,
    key: String,
    replace_document: Option<bool>,
    expected_context: Option<MemoryContext>,
    expected_value: Option<String>,
) -> CommandResult<()> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    validate_context(&agent, expected_context.as_ref())?;
    let _memory = agent.inner.memory_write_lock.lock().await;
    agent
        .remove_memory(
            scope,
            key,
            replace_document.unwrap_or(false),
            expected_value,
        )
        .map_err(crate::commands::error::CommandError::from)
}
