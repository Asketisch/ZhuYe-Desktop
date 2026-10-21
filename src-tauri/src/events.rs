//! Event 转发 —— 把 `MinimalAgent::subscribe_session()` 收的 broadcast Event
//! 通过 `app.emit("reflect_event", &event)` 推到前端。
//!
//! M2.x 升级:broadcast::Receiver 取代 M1.x 的 mpsc::Receiver,
//! 允许多个 Tauri command / 多个 webview 各自订阅同一份 event 流。
//!
//! 单一 event name `reflect_event`,前端 `services/tauri.ts` 用 `msg.type`
//! (serde discriminator `type`) 分派到对应 reducer。

use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::broadcast;

use reflect_protocol::Event;

/// Forward task —— 在 Tauri setup 阶段 spawn 一次,持续到 AppHandle drop。
///
/// 慢订阅者 (lag) 会触发 `RecvError::Lagged(n)` —— 仅日志警告,不退出任务。
///
/// ## 为什么泛型化 `R: Runtime`
///
/// 命令面为了能被能力覆盖层(mock runtime)驱动,已经去掉了与 runtime 的
/// 绑定;这里同理 —— 转发器本身只做「读 broadcast → emit 到 app」,
/// 没有任何 Wry 专属行为,写成 Wry 绑死就等于把**最后一段链路**
/// (agent 事件 → 前端 `reflect_event` 通道)排除在自动测试之外。
pub async fn forward_agent_events<R: Runtime>(
    app: AppHandle<R>,
    mut rx: broadcast::Receiver<Event>,
) {
    tracing::info!("[reflect-gui] forward_agent_events started");
    loop {
        match rx.recv().await {
            Ok(event) => {
                if let Err(e) = app.emit("reflect_event", &event) {
                    tracing::error!("[reflect-gui] emit reflect_event failed: {e}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!("[reflect-gui] forwarder lagged, dropped {n} events");
            }
            Err(broadcast::error::RecvError::Closed) => {
                tracing::warn!("[reflect-gui] forward_agent_events: broadcast channel closed");
                break;
            }
        }
    }
    tracing::warn!("[reflect-gui] forward_agent_events exited");
}
