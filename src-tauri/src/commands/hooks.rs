//! Hooks 列表 / 切换命令。

use serde::Serialize;
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

#[derive(Debug, Serialize)]
pub struct HookInfo {
    pub name: String,
    pub kind: String, // "builtin" | "custom"
    pub enabled: bool,
    pub config_summary: String,
}

#[tauri::command]
pub async fn reflect_list_hooks(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<HookInfo>> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
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
    let _transition = agent.inner.session_transition_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
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
/// `decisions` 只列当前运行时会处理的决策；空列表表示仅通知。
#[tauri::command]
pub async fn reflect_list_hook_events() -> CommandResult<Vec<HookEventInfo>> {
    use reflect_hooks::HookEventKind;
    const TOOL_DECISIONS: &[&str] = &[
        "allow",
        "deny",
        "modify_args",
        "inject_message",
        "permission_override",
        "ask",
    ];
    const INTERCEPT_DECISIONS: &[&str] = &["allow", "deny", "inject_message"];
    const NOTIFICATION: &[&str] = &[];

    let out = vec![
        (HookEventKind::PreToolUse, "工具执行前", TOOL_DECISIONS),
        (
            HookEventKind::PostToolUse,
            "工具执行后（仅通知）",
            NOTIFICATION,
        ),
        (
            HookEventKind::PostToolUseFailure,
            "工具执行失败后",
            NOTIFICATION,
        ),
        (
            HookEventKind::Stop,
            "回合结束（注入消息仅在否决结束时生效）",
            INTERCEPT_DECISIONS,
        ),
        (
            HookEventKind::SessionStart,
            "会话开始（仅通知）",
            NOTIFICATION,
        ),
        (
            HookEventKind::UserPromptSubmit,
            "用户提交输入、交给模型之前",
            INTERCEPT_DECISIONS,
        ),
        (
            HookEventKind::PreCompact,
            "上下文压缩前",
            INTERCEPT_DECISIONS,
        ),
        (
            HookEventKind::PostCompact,
            "上下文压缩后（仅信息性，不可回滚）",
            NOTIFICATION,
        ),
        (
            HookEventKind::SessionEnd,
            "会话结束（仅通知）",
            NOTIFICATION,
        ),
        (
            HookEventKind::TaskCreated,
            "任务创建后（仅通知）",
            NOTIFICATION,
        ),
        (
            HookEventKind::TaskCompleted,
            "任务被标记为完成时",
            NOTIFICATION,
        ),
        (
            HookEventKind::TaskUpdated,
            "任务其他字段变更时",
            NOTIFICATION,
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
