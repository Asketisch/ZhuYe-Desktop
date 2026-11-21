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

use serde::Serialize;
use zhuye_protocol::{Event, ThreadId};

/// v1.12:事件缺口通知的线格式。转发器在 broadcast `Lagged(n)` 时向
/// 前端推送,让 webview 主动对当前会话重放水合 —— 此前丢事件只留
/// 后端日志,前端状态静默发散。
///
/// 合成应用级通知,**不是** `EventMsg` 变体(不进引擎协议;通道同为
/// 第 6 条独立推送通道,仿 `zhuye_update_progress` 先例)。
#[derive(Debug, Clone, Serialize)]
pub struct EventGap {
    /// 丢弃的事件条数(broadcast Lagged 的 n)。
    pub dropped: u64,
    /// 缺口发生在前台通道(`zhuye_event`)还是后台通道
    /// (`zhuye_session_event`)。后台缺口由前端按 session_id 定向重灌;
    /// 前台缺口由当前会话整体 re-replay。
    pub scope: EventGapScope,
    /// 后台缺口对应的会话 id;前台缺口为 `None`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<ThreadId>,
}

/// 缺口作用域(见 [`EventGap`]）。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventGapScope {
    /// 前台主事件流(`zhuye_event`)。
    Foreground,
    /// 后台会话流(`zhuye_session_event`)。
    Background,
}

/// Forward task —— 在 Tauri setup 阶段 spawn 一次,持续到 AppHandle drop。
///
/// 慢订阅者 (lag) 会触发 `RecvError::Lagged(n)` —— 记日志 + 向前端推
/// [`EventGap`] 缺口通知(前端触发 re-replay 重同步),不退出任务。
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
                let gap = EventGap {
                    dropped: n,
                    scope: EventGapScope::Foreground,
                    session_id: None,
                };
                if let Err(e) = app.emit("zhuye_event_gap", &gap) {
                    tracing::error!("[zhuye-gui] emit zhuye_event_gap failed: {e}");
                }
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
                // v1.12:后台缺口定向通知 —— 前端按 session_id 重灌该会话的
                // scratch(丢失的增量无法凭空恢复,但 scratch 里有 replay
                // 快照兜底,整体重灌即可收敛)。
                let gap = EventGap {
                    dropped: n,
                    scope: EventGapScope::Background,
                    session_id: None,
                };
                if let Err(e) = app.emit("zhuye_event_gap", &gap) {
                    tracing::error!("[zhuye-gui] emit zhuye_event_gap failed: {e}");
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                tracing::warn!("[zhuye-gui] forward_background_events: broadcast channel closed");
                break;
            }
        }
    }
    tracing::warn!("[zhuye-gui] forward_background_events exited");
}
