//! 多 agent 讨论命令面。
//!
//! 薄包装 `reflect_app_core::discussion`,GUI 对应 CLI `reflect discussion`。
//! `reflect_run_discussion` 把编排器的 Collab* 事件包成协议信封推入
//! MinimalAgent 的 session broadcast —— 前端 reducer 既有 collab_* case
//! 实时渲染,无需新事件通道。

use std::sync::Arc;

use reflect_app_core::discussion::{
    DiscussionError, DiscussionEventSink, DiscussionRunOutcome, DiscussionSessionInfo,
};
use reflect_protocol::{EVENT_ID_NONE, Event, EventMsg};
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

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
/// Collab 事件经 session broadcast 实时推送;返回 transcript + 结构化结果。
#[tauri::command]
pub async fn reflect_run_discussion(
    agent: State<'_, MinimalAgent>,
    config_path: String,
) -> CommandResult<DiscussionRunOutcome> {
    let tx = agent.session_tx();
    let sink: DiscussionEventSink = Arc::new(move |evt: EventMsg| {
        // best-effort:无订阅者时 send 报错可忽略(与事件转发器同策略)。
        let _ = tx.send(Event {
            id: EVENT_ID_NONE.to_string(),
            msg: evt,
        });
    });
    Ok(
        reflect_app_core::discussion::run_discussion(
            std::path::Path::new(&config_path),
            Some(sink),
        )
        .await?,
    )
}
