//! Hooks 列表 / 切换命令。

use serde::Serialize;
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

#[derive(Debug, Serialize)]
pub struct HookInfo {
    pub name: String,
    pub kind: String, // "read_before_edit" | "plan_mode_gate" | "custom"
    pub enabled: bool,
    pub config_summary: String,
}

#[tauri::command]
pub async fn reflect_list_hooks(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<HookInfo>> {
    agent
        .list_hooks()
        .map_err(crate::commands::error::CommandError::from)
}

#[tauri::command]
pub async fn reflect_toggle_hook(
    agent: State<'_, MinimalAgent>,
    name: String,
    enabled: bool,
) -> CommandResult<()> {
    agent
        .toggle_hook(name, enabled)
        .map_err(crate::commands::error::CommandError::from)
}

/// 一个 hook 事件类型(camelCase 出线)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEventInfo {
    /// 事件名(snake_case,与核心 `HookEventKind` 变体同名)。
    pub kind: String,
    /// 该事件在流程中的位置 / 含义。
    pub description: String,
    /// 该事件上可用的决策。
    pub decisions: Vec<String>,
}

/// 列出核心支持的 hook 事件类型与可用决策。
///
/// 此前 GUI 只列 hook 的 name / kind / enabled —— 用户不知道**能在哪些
/// 时机**挂 hook、每个时机能做什么决策。核心的 `HookEventKind` 有 13 个
/// 变体,`HookDecision` 有 7 种,这里如实列出。
#[tauri::command]
pub async fn reflect_list_hook_events() -> CommandResult<Vec<HookEventInfo>> {
    use reflect_hooks::HookEventKind;
    // 工具类事件可用全部决策;其余事件只有部分决策有意义 —— 核心的
    // `HookEvent` 文档对此有约束,这里按同一口径列。
    const TOOL_DECISIONS: &[&str] = &[
        "allow",
        "deny",
        "modify_args",
        "inject_message",
        "permission_override",
        "ask",
    ];
    const INFO_DECISIONS: &[&str] = &["allow", "deny", "inject_message"];
    const TASK_DECISIONS: &[&str] = &["allow", "deny", "inject_message"];

    let out = vec![
        (HookEventKind::PreToolUse, "工具执行前", TOOL_DECISIONS),
        (HookEventKind::PostToolUse, "工具执行后", INFO_DECISIONS),
        (
            HookEventKind::PostToolUseFailure,
            "工具执行失败后",
            INFO_DECISIONS,
        ),
        (
            HookEventKind::Stop,
            "回合结束（模型给出最终消息）",
            INFO_DECISIONS,
        ),
        (HookEventKind::SessionStart, "会话开始", INFO_DECISIONS),
        (
            HookEventKind::UserPromptSubmit,
            "用户提交输入、交给模型之前",
            INFO_DECISIONS,
        ),
        (HookEventKind::PreCompact, "上下文压缩前", INFO_DECISIONS),
        (
            HookEventKind::PostCompact,
            "上下文压缩后（仅信息性，不可回滚）",
            INFO_DECISIONS,
        ),
        (HookEventKind::SessionEnd, "会话结束", INFO_DECISIONS),
        (HookEventKind::TaskCreated, "任务创建后", TASK_DECISIONS),
        (
            HookEventKind::TaskCompleted,
            "任务被标记为完成时",
            TASK_DECISIONS,
        ),
        (
            HookEventKind::TaskUpdated,
            "任务其他字段变更时",
            TASK_DECISIONS,
        ),
    ];
    Ok(out
        .into_iter()
        .map(|(kind, desc, decisions)| HookEventInfo {
            kind: hook_event_kind_str(kind).to_string(),
            description: desc.to_string(),
            decisions: decisions.iter().map(|d| d.to_string()).collect(),
        })
        .collect())
}

/// `HookEventKind` → 线格式字符串(与核心变体同名,snake_case)。
fn hook_event_kind_str(kind: reflect_hooks::HookEventKind) -> &'static str {
    use reflect_hooks::HookEventKind::*;
    match kind {
        PreToolUse => "pre_tool_use",
        PostToolUse => "post_tool_use",
        PostToolUseFailure => "post_tool_use_failure",
        Stop => "stop",
        SessionStart => "session_start",
        UserPromptSubmit => "user_prompt_submit",
        PreCompact => "pre_compact",
        PostCompact => "post_compact",
        SessionEnd => "session_end",
        TaskCreated => "task_created",
        TaskCompleted => "task_completed",
        TaskUpdated => "task_updated",
    }
}
