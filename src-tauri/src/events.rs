//! Event 转发 —— 把 `MinimalAgent::subscribe_session()` 收的 broadcast Event
//! 通过 `app.emit("zhuye_event", &event)` 推到前端。
//!
//! M2.x 升级:broadcast::Receiver 取代 M1.x 的 mpsc::Receiver,
//! 允许多个 Tauri command / 多个 webview 各自订阅同一份 event 流。
//!
//! 单一 event name `zhuye_event`,前端 `services/tauri.ts` 用 `msg.type`
//! (serde discriminator `type`) 分派到对应 reducer。

use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::broadcast;

use zhuye_protocol::{Event, ThreadId};
use serde::Serialize;

/// Forward task —— 在 Tauri setup 阶段 spawn 一次,持续到 AppHandle drop。
///
/// 慢订阅者 (lag) 会触发 `RecvError::Lagged(n)` —— 仅日志警告,不退出任务。
///
/// ## 为什么泛型化 `R: Runtime`
///
/// 命令面为了能被能力覆盖层(mock runtime)驱动,已经去掉了与 runtime 的
/// 绑定;这里同理 —— 转发器本身只做「读 broadcast → emit 到 app」,
/// 没有任何 Wry 专属行为,写成 Wry 绑死就等于把**最后一段链路**
/// (agent 事件 → 前端 `zhuye_event` 通道)排除在自动测试之外。
pub async fn forward_agent_events<R: Runtime>(
    app: AppHandle<R>,
    mut rx: broadcast::Receiver<Event>,
) {
    tracing::info!("[zhuye-gui] forward_agent_events started");
    loop {
        match rx.recv().await {
            Ok(event) => {
                if let Err(e) = app.emit("zhuye_event", &event) {
                    tracing::error!("[zhuye-gui] emit zhuye_event failed: {e}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!("[zhuye-gui] forwarder lagged, dropped {n} events");
            }
            Err(broadcast::error::RecvError::Closed) => {
                tracing::warn!("[zhuye-gui] forward_agent_events: broadcast channel closed");
                break;
            }
        }
    }
    tracing::warn!("[zhuye-gui] forward_agent_events exited");
}

/// 后台会话事件的线格式:`{ session_id, event }`(v1.x 后台持续运行)。
/// 前端据此维护后台会话的运行徽标 / 待确认交互(见
/// `src/stores/backgroundSessions.ts`),不进主 reducer。
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundEvent {
    pub session_id: ThreadId,
    pub event: Event,
}

/// 后台通道转发任务 —— 与 [`forward_agent_events`] 同款生命周期与 lag 容忍,
/// 通道名为 `zhuye_session_event`(前台通道 `zhuye_event` 线格式不变)。
pub async fn forward_background_events<R: Runtime>(
    app: AppHandle<R>,
    mut rx: broadcast::Receiver<(ThreadId, Event)>,
) {
    tracing::info!("[zhuye-gui] forward_background_events started");
    loop {
        match rx.recv().await {
            Ok((session_id, event)) => {
                let payload = BackgroundEvent { session_id, event };
                if let Err(e) = app.emit("zhuye_session_event", &payload) {
                    tracing::error!("[zhuye-gui] emit zhuye_session_event failed: {e}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!("[zhuye-gui] background forwarder lagged, dropped {n} events");
            }
            Err(broadcast::error::RecvError::Closed) => {
                tracing::warn!("[zhuye-gui] forward_background_events: broadcast channel closed");
                break;
            }
        }
    }
    tracing::warn!("[zhuye-gui] forward_background_events exited");
}
