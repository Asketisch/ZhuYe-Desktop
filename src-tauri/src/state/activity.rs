//! Activity logger 订阅 task。
//!
//! `install_agent_thread` 调 [`subscribe_activity_logger`],spawn 一个独立
//! task 拿 `subscribe_session()` 的 receiver,把每个 `Event` 映射成
//! `ActivityEvent` 写入 `ActivityLogger`。
//!
//! 与 [`crate::events::forward_agent_events`] 并行 —— 后者把 Event 推给
//! Tauri webview(`reflect_event` channel),本 task 把 Event 沉淀成本地审计
//! timeline。两者互不阻塞(各自独立的 broadcast receiver)。

use reflect_app_core::activity::{ActivityEvent, ActivityKind, ActivityLevel};
use reflect_app_core::actor::Actor;
use reflect_protocol::{Event, EventMsg};

use super::MinimalAgent;

/// spawn activity logger 订阅 task(幂等:可多次调,每次多一个 receiver)。
pub(crate) fn subscribe_activity_logger(agent: &MinimalAgent) {
    let logger = agent.activity_logger();
    let mut rx = agent.subscribe_session();
    tauri::async_runtime::spawn(async move {
        tracing::info!("[reflect-gui] activity logger subscription started");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(activity) = map_event(&event) {
                        if let Err(e) = logger.record(activity) {
                            tracing::warn!("[activity] record failed: {e}");
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("[activity] lagged by {n} events, continuing");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::info!("[activity] broadcast closed, subscription exiting");
                    break;
                }
            }
        }
    });
}

/// 把 `reflect_protocol::Event` 映射成 `ActivityEvent`(None = 不记录)。
///
/// 默认 actor 是 `Actor::user()`(本地用户发起的动作);agent message / tool
/// 类事件归类为 system actor。team/task 类事件目前没有直接 hook,留待
/// `TaskManager::with_event_sink` 后续接入(本函数先覆盖 turn/tool/plan/error)。
fn map_event(event: &Event) -> Option<ActivityEvent> {
    let (kind, summary, level, actor) = match &event.msg {
        EventMsg::TurnStarted(_) => (
            ActivityKind::TurnStarted,
            "Turn started".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::TurnComplete(_) => (
            ActivityKind::TurnComplete,
            "Turn complete".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::TurnAborted(_) => (
            ActivityKind::TurnAborted,
            "Turn aborted".to_string(),
            ActivityLevel::Warn,
            Actor::user(),
        ),
        EventMsg::AgentMessage(_) => (
            ActivityKind::AgentMessage,
            "Agent sent a message".to_string(),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::ToolCallBegin(e) => (
            ActivityKind::ToolCallBegin,
            format!("Tool started: {}", e.tool_name),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::ToolCallEnd(_) => (
            ActivityKind::ToolCallEnd,
            "Tool finished".to_string(),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::ApprovalRequest(e) => (
            ActivityKind::ApprovalRequest,
            format!("Approval pending: {:?}", e.kind),
            ActivityLevel::Warn,
            Actor::user(),
        ),
        EventMsg::AskUserQuestion(_) => (
            ActivityKind::ApprovalRequest,
            "Agent asked a question".to_string(),
            ActivityLevel::Warn,
            Actor::user(),
        ),
        EventMsg::AskUserInput(_) => (
            ActivityKind::ApprovalRequest,
            "Agent requested input".to_string(),
            ActivityLevel::Warn,
            Actor::user(),
        ),
        EventMsg::PlanRequest(_) => (
            ActivityKind::PlanRequest,
            "Plan requested".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::PlanReady(_) => (
            ActivityKind::PlanRequest,
            "Plan ready for review".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::PlanApproved(_) => (
            ActivityKind::PlanApproved,
            "Plan approved".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::PlanRejected(_) => (
            ActivityKind::PlanRejected,
            "Plan rejected".to_string(),
            ActivityLevel::Warn,
            Actor::user(),
        ),
        EventMsg::PermissionModeChanged(e) => (
            ActivityKind::PermissionModeChanged,
            format!("Permission mode changed: {:?}", e.to),
            ActivityLevel::Info,
            Actor::user(),
        ),
        EventMsg::ContextCompacted(_) => (
            ActivityKind::ContextCompacted,
            "Context compacted".to_string(),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::Error(e) => (
            ActivityKind::Error,
            format!("Error: {}", e.message),
            ActivityLevel::Error,
            Actor::system(),
        ),
        EventMsg::StreamError(e) => (
            ActivityKind::Error,
            format!("Stream error: {}", e.message),
            ActivityLevel::Error,
            Actor::system(),
        ),
        EventMsg::McpServerStarted(e) => (
            ActivityKind::McpServer,
            format!("MCP server started: {}", e.server),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::McpServerFailed(e) => (
            ActivityKind::McpServer,
            format!("MCP server failed: {}", e.server),
            ActivityLevel::Error,
            Actor::system(),
        ),
        EventMsg::LspServerStarted(e) => (
            ActivityKind::LspServer,
            format!("LSP server started: {}", e.server),
            ActivityLevel::Info,
            Actor::system(),
        ),
        EventMsg::LspServerFailed(e) => (
            ActivityKind::LspServer,
            format!("LSP server failed: {}", e.server),
            ActivityLevel::Error,
            Actor::system(),
        ),
        EventMsg::SessionConfigured(_) => (
            ActivityKind::SessionConfigured,
            "Session configured".to_string(),
            ActivityLevel::Info,
            Actor::user(),
        ),
        // 忽略高频 / 低价值事件(deltas / token count / routing)。
        EventMsg::AgentMessageDelta(_)
        | EventMsg::ThinkingDelta(_)
        | EventMsg::TokenCount(_)
        | EventMsg::Routing(_)
        | EventMsg::ConfigReloaded(_)
        | EventMsg::PermissionBubble(_)
        | EventMsg::CollabStarted(_)
        | EventMsg::CollabMessage(_)
        | EventMsg::CollabFinished(_)
        | EventMsg::McpToolInvoked(_)
        | EventMsg::TurnRewound(_)
        // PlanStep 高频进度更新 + PluginLoaded(暂无合适 ActivityKind)忽略;
        // 类型完整性已在 src/types/protocol/event.ts 补全。
        | EventMsg::PlanStep(_)
        // PlanDraftUpdated:计划草稿增量更新(高频,暂无对应 ActivityKind)忽略。
        | EventMsg::PlanDraftUpdated(_)
        // ToolCallOutputDelta:工具输出流式增量(高频 delta,与 AgentMessageDelta 同性质)忽略。
        | EventMsg::ToolCallOutputDelta(_)
        // SubagentProgress:子代理逐条进度推送(Message/ToolBegin/ToolEnd,高频)忽略。
        | EventMsg::SubagentProgress(_)
        // SubagentStatus:`Op::QuerySubagents` 的拉取式应答快照(前端 store 消费,
        // 非生命周期里程碑)忽略。
        | EventMsg::SubagentStatus(_)
        // ToolExecutionRequest:serve 模式远程工具执行请求,Desktop 内嵌
        // AgentThread 不注册远程工具,不会收到;保穷尽忽略。
        | EventMsg::ToolExecutionRequest(_)
        | EventMsg::PluginLoaded(_)
        // SubmissionClosed:submission 生命周期收尾信号(无用户可见语义),
        // 与其余 lifecycle 事件一样不进 activity timeline。
        | EventMsg::SubmissionClosed
        // PromptList:`Op::PromptCommand { action: List }` 的拉取式应答快照
        // (前端提示词层选择面板消费),与 SubagentStatus 同性质 —— 非里程碑。
        | EventMsg::PromptList(_)
        // PromptSwitched:提示词库重扫完成,前端以 toast 提示「提示词已刷新」
        // 并展示新命中层;activity timeline 不重复记录(同一语义两处留痕会噪音)。
        | EventMsg::PromptSwitched(_)
        | EventMsg::ShutdownComplete => return None,

        // QuotaExhausted —— 配额耗尽(独立分支,展示为 Warn)。
        EventMsg::QuotaExhausted(e) => (
            ActivityKind::Error,
            format!(
                "Quota exhausted: {}/{} ({} tokens used, window ends in {}s)",
                e.provider, e.label, e.used_tokens, e.window_ends_secs
            ),
            ActivityLevel::Warn,
            Actor::system(),
        ),
    };
    Some(ActivityEvent {
        id: String::new(),
        ts_ms: reflect_app_core::activity::now_ms(),
        kind,
        actor,
        summary,
        task_id: None,
        team_name: None,
        level,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_app_core::activity::ActivityKind;
    use reflect_protocol::{
        AgentMessage, AgentMessageDelta, Event, EventMsg, PermissionMode,
        PermissionModeChangedEvent, ToolCallBeginEvent, TurnStartedEvent,
    };

    fn mk_event(msg: EventMsg) -> Event {
        Event {
            id: "evt-test".into(),
            msg,
        }
    }

    #[test]
    fn turn_started_maps() {
        let e = mk_event(EventMsg::TurnStarted(TurnStartedEvent {
            turn_id: reflect_protocol::TurnId::new(),
            user_message_id: None,
        }));
        let a = map_event(&e).unwrap();
        assert_eq!(a.kind, ActivityKind::TurnStarted);
    }

    #[test]
    fn tool_call_begin_has_tool_name_in_summary() {
        let e = mk_event(EventMsg::ToolCallBegin(ToolCallBeginEvent {
            call_id: "c1".into(),
            tool_name: "Bash".into(),
            args: serde_json::json!({}),
            child_id: None,
        }));
        let a = map_event(&e).unwrap();
        assert!(a.summary.contains("Bash"));
    }

    #[test]
    fn permission_mode_changed_records() {
        let e = mk_event(EventMsg::PermissionModeChanged(
            PermissionModeChangedEvent {
                from: PermissionMode::Prompt,
                to: PermissionMode::AcceptEdits,
            },
        ));
        let a = map_event(&e).unwrap();
        assert_eq!(a.kind, ActivityKind::PermissionModeChanged);
    }

    #[test]
    fn agent_message_uses_system_actor() {
        let e = mk_event(EventMsg::AgentMessage(AgentMessage { text: "hi".into() }));
        let a = map_event(&e).unwrap();
        assert_eq!(a.actor.actor_id, "system");
    }

    #[test]
    fn deltas_are_filtered_out() {
        let e = mk_event(EventMsg::AgentMessageDelta(AgentMessageDelta {
            delta: "x".into(),
        }));
        assert!(map_event(&e).is_none());
    }
}
