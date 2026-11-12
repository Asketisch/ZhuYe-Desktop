//! 多 agent 讨论命令面。
//!
//! 薄包装 `reflect_app_core::discussion`,GUI 对应 CLI `reflect discussion`。
//! `reflect_run_discussion` 把编排器的 Collab* 事件包成协议信封推入
//! MinimalAgent 的 session broadcast —— 前端 reducer 既有 collab_* case
//! 实时渲染,无需新事件通道。

use std::sync::Arc;

use chrono::Utc;
use reflect_app_core::discussion::{
    DiscussionError, DiscussionEventSink, DiscussionRunOutcome, DiscussionSessionInfo,
};
use reflect_protocol::{EVENT_ID_NONE, Event, EventMsg, RolloutRecord};
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

struct DiscussionCancellationGuard {
    agent: MinimalAgent,
    id: u64,
}

impl Drop for DiscussionCancellationGuard {
    fn drop(&mut self) {
        self.agent.remove_discussion_cancellation(self.id);
    }
}

impl From<DiscussionError> for super::error::CommandError {
    fn from(e: DiscussionError) -> Self {
        super::error::CommandError { msg: e.to_string() }
    }
}

/// 列出含讨论记录的 session(可按 discussion id 过滤)。
#[tauri::command]
pub async fn reflect_list_discussions(
    _agent: State<'_, MinimalAgent>,
    discussion_id: Option<String>,
) -> CommandResult<Vec<DiscussionSessionInfo>> {
    Ok(reflect_app_core::discussion::list_discussions(
        discussion_id.as_deref(),
    )?)
}

/// 运行一次多 agent 讨论(读 TOML 配置,阻塞至结束)。
///
/// Collab 事件经 session broadcast 转发;返回 transcript + 结构化结果。
#[tauri::command]
pub async fn reflect_run_discussion(
    agent: State<'_, MinimalAgent>,
    config_path: String,
) -> CommandResult<DiscussionRunOutcome> {
    let agent_handle: MinimalAgent = (*agent).clone();
    let (cancel_id, cancel) = agent.register_discussion_cancellation();
    let cancellation = DiscussionCancellationGuard {
        agent: agent_handle,
        id: cancel_id,
    };
    let tx = agent.session_tx();
    let sink: DiscussionEventSink = Arc::new(move |evt: EventMsg| {
        // best-effort:无订阅者时 send 报错可忽略(与事件转发器同策略)。
        let _ = tx.send(Event {
            id: EVENT_ID_NONE.to_string(),
            msg: evt,
        });
    });
    let recorder = agent.session_recorder();
    if let (Some(recorder), Some(session_id)) = (recorder.clone(), agent.bound_session_id()) {
        let base = reflect_rollout::path::default_base();
        if reflect_rollout::index::find_file_by_session_id(&base, &session_id)?.is_none() {
            recorder
                .record(RolloutRecord::SessionMeta {
                    session_id,
                    model: agent.model_spec(),
                    started_at: Utc::now(),
                    workspace: Some(agent.workspace().to_string_lossy().into_owned()),
                })
                .await
                .map_err(|error| super::error::CommandError {
                    msg: error.to_string(),
                })?;
        }
    }
    let result = reflect_app_core::discussion::run_discussion_with_cancel(
        std::path::Path::new(&config_path),
        Some(sink),
        recorder,
        cancel,
    )
    .await;
    drop(cancellation);
    Ok(result?)
}

/// 取消当前进程内仍在运行的讨论。
///
/// 返回被触发的讨论数量；没有运行中讨论时为 0（幂等）。
#[tauri::command]
pub fn reflect_cancel_discussions(agent: State<'_, MinimalAgent>) -> CommandResult<usize> {
    Ok(agent.cancel_discussions())
}
