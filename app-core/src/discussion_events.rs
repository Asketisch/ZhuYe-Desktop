//! Event and history helpers for the desktop discussion adapter.

use reflect_discussion::models::{DiscussionId, DiscussionMessage, MessageKind};
use reflect_protocol::{CollabMessageEvent, EventMsg, RolloutRecord};

use crate::discussion::{DiscussionError, DiscussionEventSink};

pub(crate) fn emit_discussion_message(
    sink: &DiscussionEventSink,
    discussion_id: DiscussionId,
    message: &DiscussionMessage,
) {
    sink(EventMsg::CollabMessage(CollabMessageEvent {
        id: discussion_id.to_string(),
        from: message.from.0.clone(),
        kind: match message.kind {
            MessageKind::Utterance => "utterance",
            MessageKind::Consensus => "consensus",
            MessageKind::Finish => "finish",
        }
        .into(),
        content: message.content.clone(),
        round: message.round,
        token_usage: message.token_usage_as_protocol(),
    }));
}

pub(crate) fn message_key(discussion_id: &DiscussionId, message: &DiscussionMessage) -> String {
    format!("{}:{}", discussion_id, message.id.0)
}

pub(crate) fn path_has_discussion(path: &std::path::Path) -> bool {
    let Ok(body) = std::fs::read_to_string(path) else {
        return false;
    };
    body.lines().any(|line| {
        matches!(
            serde_json::from_str::<RolloutRecord>(line),
            Ok(RolloutRecord::DiscussionTranscript { .. })
        )
    })
}

/// 历史讨论 session 条目(对应 CLI `discussion ls` 输出列)。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionSessionInfo {
    /// session id(ThreadId uuid)。
    pub session_id: String,
    /// 可读标题(rollout 自定义名 / AI 标题,可能缺省)。
    pub title: Option<String>,
    /// 会话模型。
    pub model: String,
    /// 开始时间(RFC3339)。
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// 消息数。
    pub message_count: usize,
}

/// 列出含讨论记录的 session。
///
/// `discussion_id = Some(id)` 时仅列包含该讨论 id 的 session;`None` 列全部
/// session(与 CLI v0.2.4 的 fallback 语义一致)。
pub fn list_discussions(
    discussion_id: Option<&str>,
) -> Result<Vec<DiscussionSessionInfo>, DiscussionError> {
    let base = reflect_rollout::path::default_base();
    let sessions = match discussion_id {
        Some(id) => reflect_rollout::index::list_sessions_with_discussion(&base, id)
            .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?,
        None => reflect_rollout::index::list_sessions(&base)
            .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?
            .into_iter()
            .filter(|session| {
                reflect_rollout::index::find_file_by_session_id(&base, &session.session_id)
                    .is_ok_and(|path| path.is_some_and(|path| path_has_discussion(&path)))
            })
            .collect(),
    };
    Ok(sessions
        .into_iter()
        .map(|s| DiscussionSessionInfo {
            session_id: s.session_id.to_string(),
            title: s.title,
            model: s.model,
            started_at: s.started_at,
            message_count: s.message_count,
        })
        .collect())
}
