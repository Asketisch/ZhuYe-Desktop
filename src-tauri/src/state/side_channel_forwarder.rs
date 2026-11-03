//! Side-channel 终态事件补发 —— registry 广播 → 协议 `reflect_event` 通道。
//!
//! 引擎的 `SideChannelDriver` 在后台 task 里推进 registry 终态
//! (Done / Cancelled / Error),但只调 `registry.finish`(进程内状态),
//! **不发协议事件**:`EventMsg::SideChannelFinished` 仅在
//! `Op::StartSideChannel` 的启动失败路径由 submission_loop 发出。结果
//! 是运行中的 side-channel 完成后,前端只能靠下一次快照查询才看到。
//!
//! 桌面端持有进程级共享 registry(`MinimalAgentInner.side_channels`,
//! 与 driver 同一份 Arc),本模块订阅它的 broadcast,把**终态**事件映射
//! 成协议信封补发到 `reflect_event` 通道:
//!
//! - `Started` 跳过 —— submission_loop 已经带 submission id 发过一次,
//!   补发会造成前端 revision 双计;
//! - 终态用 `EVENT_ID_NONE`(不绑定 submission,协议对生命周期事件的
//!   约定),载荷形状与协议 `SideChannelEvent` 一一对应(core 侧类型
//!   刻意与 protocol 同形,只做字段搬运)。
//!
//! `install_agent_thread` / fixture 与 `subscribe_activity_logger` 并行
//! spawn —— 各自独立的 broadcast receiver,互不阻塞。

use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::broadcast;

use reflect_core::side_channel::SideChannelEvent as RegistryEvent;
use reflect_protocol::{EVENT_ID_NONE, Event, EventMsg};

/// 把 registry 广播事件映射成协议 `EventMsg`(None = 不补发)。
///
/// `Started` 由 submission_loop 发(带 submission id),这里跳过避免双计。
fn to_protocol_event(event: &RegistryEvent) -> Option<EventMsg> {
    let finished = match event {
        RegistryEvent::Started { .. } => return None,
        RegistryEvent::Done {
            id,
            finished_at_ms,
            summary,
        } => reflect_protocol::SideChannelEvent::Done {
            id: id.clone(),
            finished_at_ms: *finished_at_ms,
            summary: summary.clone(),
        },
        RegistryEvent::Cancelled { id, finished_at_ms } => {
            reflect_protocol::SideChannelEvent::Cancelled {
                id: id.clone(),
                finished_at_ms: *finished_at_ms,
            }
        }
        RegistryEvent::Error {
            id,
            finished_at_ms,
            message,
        } => reflect_protocol::SideChannelEvent::Error {
            id: id.clone(),
            finished_at_ms: *finished_at_ms,
            message: message.clone(),
        },
    };
    Some(EventMsg::SideChannelFinished(finished))
}

/// spawn 终态补发 task(幂等:可多次调,每次多一个 receiver)。
///
/// `pub`:能力覆盖层夹具(mock app 未 `set_app_handle`,install 里的
/// 自动 spawn 会跳过)需要显式调它,与 `forward_agent_events` 同待遇。
pub fn spawn_side_channel_forwarder<R: Runtime>(
    app: AppHandle<R>,
    registry: &reflect_core::side_channel::SideChannelRegistry,
) {
    let mut rx = registry.subscribe_events();
    tauri::async_runtime::spawn(async move {
        tracing::info!("[reflect-gui] side-channel terminal-event forwarder started");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let Some(msg) = to_protocol_event(&event) else {
                        continue;
                    };
                    let event = Event {
                        id: EVENT_ID_NONE.into(),
                        msg,
                    };
                    if let Err(e) = app.emit("reflect_event", &event) {
                        tracing::error!(
                            "[reflect-gui] emit side-channel terminal event failed: {e}"
                        );
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("[side-channel-forwarder] lagged by {n} events, continuing");
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::info!("[side-channel-forwarder] registry broadcast closed, exiting");
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(event: RegistryEvent) -> Option<reflect_protocol::SideChannelEvent> {
        to_protocol_event(&event).map(|msg| match msg {
            EventMsg::SideChannelFinished(e) => e,
            other => panic!("应映射为 SideChannelFinished,实际: {other:?}"),
        })
    }

    #[test]
    fn started_is_skipped_to_avoid_double_counting() {
        let event = RegistryEvent::Started {
            id: "side-00000001".into(),
            agent_name: "explorer".into(),
            prompt: "p".into(),
            started_at_ms: 1,
        };
        assert!(to_protocol_event(&event).is_none());
    }

    #[test]
    fn done_maps_fields_verbatim() {
        let event = RegistryEvent::Done {
            id: "side-00000002".into(),
            finished_at_ms: 42,
            summary: Some("ok".into()),
        };
        let mapped = map(event).expect("Done 应补发");
        match mapped {
            reflect_protocol::SideChannelEvent::Done {
                id,
                finished_at_ms,
                summary,
            } => {
                assert_eq!(id, "side-00000002");
                assert_eq!(finished_at_ms, 42);
                assert_eq!(summary.as_deref(), Some("ok"));
            }
            other => panic!("应映射为 Done,实际: {other:?}"),
        }
    }

    #[test]
    fn cancelled_and_error_map_fields_verbatim() {
        let cancelled = map(RegistryEvent::Cancelled {
            id: "side-00000003".into(),
            finished_at_ms: 7,
        })
        .expect("Cancelled 应补发");
        assert!(matches!(
            cancelled,
            reflect_protocol::SideChannelEvent::Cancelled { ref id, finished_at_ms: 7 }
            if id == "side-00000003"
        ));

        let error = map(RegistryEvent::Error {
            id: "side-00000004".into(),
            finished_at_ms: 9,
            message: "boom".into(),
        })
        .expect("Error 应补发");
        match error {
            reflect_protocol::SideChannelEvent::Error { message, .. } => {
                assert_eq!(message, "boom");
            }
            other => panic!("应映射为 Error,实际: {other:?}"),
        }
    }

    #[test]
    fn terminal_events_reach_subscribers_via_registry_broadcast() {
        // 端到端冒烟:注册表广播 → to_protocol_event 映射可用。
        // (AppHandle 的 emit 链路由能力覆盖层 ipc_domains 的真 IPC 断言覆盖。)
        let registry = reflect_core::side_channel::SideChannelRegistry::new();
        let mut rx = registry.subscribe_events();
        let (id, _cancel) = registry.start("explorer".into(), "p".into());
        let started = rx.try_recv().expect("start 应广播 Started");
        assert!(matches!(
            started,
            RegistryEvent::Started { ref agent_name, .. } if agent_name == "explorer"
        ));
        assert!(registry.cancel(&id), "取消运行中的通道应生效");
        let cancelled = rx.try_recv().expect("cancel 应广播 Cancelled");
        let mapped = to_protocol_event(&cancelled).expect("Cancelled 应映射");
        assert!(matches!(
            mapped,
            EventMsg::SideChannelFinished(ref e)
            if matches!(e, reflect_protocol::SideChannelEvent::Cancelled { .. })
        ));
    }
}
