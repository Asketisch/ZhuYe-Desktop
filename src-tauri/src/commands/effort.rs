//! 推理强度(effort)命令 —— `Op::SetEffort` 桥接 + 当前档位回读。
//!
//! 从 `commands/agent.rs` 分出:agent.rs 顶到文件大小预算上限,而 effort
//! 是独立的用户设置域(Composer 控件 / `/effort` slash / Models 视图三处
//! UI 消费),值得自己的模块。

use tauri::State;

use reflect_protocol::{Op, ReasoningEffortMirror};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 设置 reasoning effort(前端 Composer 控件 / `/effort` slash 发起)。
///
/// wire 上 `level` 是字符串,这里转成 `ReasoningEffortMirror`。
#[tauri::command]
pub async fn reflect_set_effort(
    agent: State<'_, MinimalAgent>,
    level: String,
) -> CommandResult<String> {
    let effort = parse_effort(&level)?;
    Ok(agent.submit_op(Op::SetEffort { effort }).await?)
}

/// 读回当前 reasoning effort(`AgentConfig::current_effort`,协议无对应
/// 回读事件,这里从线程内槽直读)。前端 Composer/Models 控件初始化用。
/// 线程未安装(pre-install)时回落默认 `low`。
#[tauri::command]
pub async fn reflect_get_effort(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    let guard = agent.inner.thread.lock();
    let Some(thread) = guard.as_ref() else {
        return Ok("low".to_string());
    };
    Ok(match thread.config().current_effort() {
        ReasoningEffortMirror::Low => "low",
        ReasoningEffortMirror::Medium => "medium",
        ReasoningEffortMirror::High => "high",
        ReasoningEffortMirror::Max => "max",
        ReasoningEffortMirror::Ultra => "ultra",
    }
    .to_string())
}

/// `"low"|"medium"|"high"|"max"|"ultra"` → `ReasoningEffortMirror`
/// (上游 v1.x 起新增 max / ultra 档,按模型能力表在发送前钳制)。
fn parse_effort(s: &str) -> CommandResult<ReasoningEffortMirror> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "low" => ReasoningEffortMirror::Low,
        "medium" => ReasoningEffortMirror::Medium,
        "high" => ReasoningEffortMirror::High,
        "max" => ReasoningEffortMirror::Max,
        "ultra" => ReasoningEffortMirror::Ultra,
        other => {
            return Err(CommandError {
                msg: format!("invalid effort '{other}'; expected low|medium|high|max|ultra"),
            });
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_effort_round_trip() {
        assert_eq!(parse_effort("low").unwrap(), ReasoningEffortMirror::Low);
        assert_eq!(
            parse_effort("Medium").unwrap(),
            ReasoningEffortMirror::Medium
        );
        assert_eq!(parse_effort("HIGH").unwrap(), ReasoningEffortMirror::High);
        // 上游 v1.x 新档位:max / ultra。
        assert_eq!(parse_effort("max").unwrap(), ReasoningEffortMirror::Max);
        assert_eq!(parse_effort("ULTRA").unwrap(), ReasoningEffortMirror::Ultra);
        assert!(parse_effort("nope").is_err());
    }
}
