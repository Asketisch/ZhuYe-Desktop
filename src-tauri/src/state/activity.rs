//! Activity logger 订阅 task。
//!
//! `install_agent_thread` 调 [`subscribe_activity_logger`],spawn 一个独立
//! task 拿 `subscribe_session()` 的 receiver,把每个 `Event` 经
//! `reflect_telemetry::activity::map_event`(上游收编版,剥 tauri)映射成
//! `ActivityEvent` 写入 `ActivityLogger`。
//!
//! 与 [`crate::events::forward_agent_events`] 并行 —— 后者把 Event 推给
//! Tauri webview(`reflect_event` channel),本 task 把 Event 沉淀成本地审计
//! timeline。两者互不阻塞(各自独立的 broadcast receiver)。
//!
//! logger 经 `ActivityLog` 句柄逐事件取用:Inbox「清空」原地换新 logger
//! 后,本 task 自动写进新实例,不需要重启订阅。

use reflect_app_core::activity::map_event;

use super::MinimalAgent;

/// spawn activity logger 订阅 task(幂等:可多次调,每次多一个 receiver)。
pub(crate) fn subscribe_activity_logger(agent: &MinimalAgent) {
    let log = agent.activity_log();
    let mut rx = agent.subscribe_session();
    tauri::async_runtime::spawn(async move {
        tracing::info!("[reflect-gui] activity logger subscription started");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(activity) = map_event(&event)
                        && let Err(e) = log.record(activity)
                    {
                        tracing::warn!("[activity] record failed: {e}");
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
