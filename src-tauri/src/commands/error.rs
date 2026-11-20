//! 命令层错误类型。
//!
//! 所有 `#[tauri::command]` 函数的统一返回类型包装。

use serde::Serialize;

/// 包装任意 command 错误的统一错误类型。
#[derive(Debug, Serialize)]
pub struct CommandError {
    pub(crate) msg: String,
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.msg)
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(e: anyhow::Error) -> Self {
        Self { msg: e.to_string() }
    }
}

impl From<String> for CommandError {
    fn from(s: String) -> Self {
        Self { msg: s }
    }
}

impl From<&str> for CommandError {
    fn from(s: &str) -> Self {
        Self { msg: s.to_string() }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        Self { msg: e.to_string() }
    }
}

impl From<zhuye_config::ConfigError> for CommandError {
    fn from(e: zhuye_config::ConfigError) -> Self {
        Self { msg: e.to_string() }
    }
}

impl From<zhuye_task::TaskError> for CommandError {
    fn from(e: zhuye_task::TaskError) -> Self {
        Self { msg: e.to_string() }
    }
}

impl From<zhuye_stream::cron::CronParseError> for CommandError {
    fn from(e: zhuye_stream::cron::CronParseError) -> Self {
        Self { msg: e.to_string() }
    }
}

impl From<zhuye_agent_def::AgentDefError> for CommandError {
    fn from(e: zhuye_agent_def::AgentDefError) -> Self {
        Self { msg: e.to_string() }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
