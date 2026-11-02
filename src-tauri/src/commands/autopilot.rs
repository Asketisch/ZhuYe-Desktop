//! Autopilot 命令。
//!
//! Autopilot 配置和历史存储；尚未接入自动调度。
//! `reflect_stream::autopilot::AutopilotManager` 的薄包装,
//! 把配置和运行历史暴露给前端。
//!
//! ## 命令清单
//!
//! - `reflect_get_autopilot_config` — 读取当前配置
//! - `reflect_update_autopilot_config(config)` — 写入新配置
//! - `reflect_autopilot_history` — 拉取最近 run 历史

use reflect_stream::autopilot::{AutopilotConfig, AutopilotRun};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 读取当前 autopilot 配置。
#[tauri::command]
pub async fn reflect_get_autopilot_config(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<AutopilotConfig> {
    agent
        .autopilot_manager()
        .load_config()
        .map_err(CommandError::from)
}

/// 更新 autopilot 配置。
#[tauri::command]
pub async fn reflect_update_autopilot_config(
    agent: State<'_, MinimalAgent>,
    config: AutopilotConfig,
) -> CommandResult<()> {
    agent
        .autopilot_manager()
        .save_config(&config)
        .map_err(|e| CommandError { msg: e.to_string() })
}

/// 读取 autopilot 的运行历史。
#[tauri::command]
pub async fn reflect_autopilot_history(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<AutopilotRun>> {
    agent
        .autopilot_manager()
        .load_history()
        .map_err(CommandError::from)
}
