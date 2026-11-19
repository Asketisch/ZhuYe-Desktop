//! Session-level broadcast 入口:forwarder 启动 + `subscribe_session` /
//! `session_tx` 句柄 + 前台/后台事件分流。
//!
//! 所有 Tauri command / webview 共享同一个 `broadcast::Sender<Event>`;
//! `start_forwarder` 把 `AgentThread::subscribe_session()` 的 mpsc 流
//! 持续 `recv().await` 并按线程归属分流:
//! - 前台(当前槽内)线程 → `session_tx`(前端唯一订阅点 `reflect_event`,线格式不变);
//! - 后台线程 → `background_tx`(带 session id,前端维护运行徽标 /
//!   待确认交互;切回该会话时 bind→promote,事件自然回到前台通道)。

use reflect_protocol::{Event, ThreadId};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::MinimalAgent;

/// 事件路由:v1.x 后台持续运行改造 —— 非前台线程的事件不再丢弃,
/// 带 session id 发到 `background_tx`(sid = `None` 的 install 占位线程
/// 仍丢弃,与旧行为一致)。检查和发送之间持有槽锁,避免重绑时混入旧事件。
pub(crate) fn route_event(
    inner: &super::agent::MinimalAgentInner,
    thread: &Arc<reflect_core::AgentThread>,
    sid: Option<ThreadId>,
    event: Event,
) {
    let current = inner.thread.lock();
    if current
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(active, thread))
    {
        let _ = inner.session_tx.send(event);
    } else if let Some(sid) = sid {
        let _ = inner.background_tx.send((sid, event));
    }
}

/// forwarder 顺带维护 `background_running`(该会话是否有 turn 在跑,
/// 服务后台线程的驱逐策略)。
fn track_running(inner: &super::agent::MinimalAgentInner, sid: Option<ThreadId>, event: &Event) {
    let Some(sid) = sid else { return };
    let mut running = inner.background_running.lock();
    match &event.msg {
        reflect_protocol::EventMsg::TurnStarted(_) => {
            running.insert(sid);
        }
        reflect_protocol::EventMsg::TurnComplete(_)
        | reflect_protocol::EventMsg::TurnAborted(_) => {
            running.remove(&sid);
        }
        _ => {}
    }
}

/// 启动 session 事件转发:从 `AgentThread::subscribe_session()` 拿 mpsc::Receiver,
/// 持续 `recv().await` 并按 [`route_event`] 分流。
///
/// `sid` 是该 thread 绑定的会话 id(install 占位线程为 `None`)——
/// 线程被换绑降级到后台后,forwarder 继续存活并以此为标签把事件发往
/// 后台通道,直到线程通道关闭自然退出。
///
/// 在 `install_agent_thread` / `rebind_session` 内部调用,外部不应直接调。
pub(crate) fn start_forwarder(agent: &MinimalAgent, sid: Option<ThreadId>) {
    let thread_lock = agent.inner.thread.lock();
    let Some(thread) = thread_lock.clone() else {
        tracing::error!("[reflect-gui] start called before install_agent_thread");
        return;
    };
    drop(thread_lock);

    let mut session_rx = thread.subscribe_session();
    let inner = agent.inner.clone();
    tauri::async_runtime::spawn(async move {
        tracing::info!("[reflect-gui] session forward task started");
        while let Some(event) = session_rx.recv().await {
            track_running(&inner, sid, &event);
            route_event(&inner, &thread, sid, event);
        }
        tracing::warn!("[reflect-gui] session forward task exited (AgentThread closed)");
    });
}

/// 订阅 session 级 broadcast。前端 Tauri listener 拿到的就是这个 receiver。
pub(crate) fn subscribe_session(agent: &MinimalAgent) -> broadcast::Receiver<Event> {
    agent.inner.session_tx.subscribe()
}

/// 订阅后台会话 broadcast(前端 `reflect_session_event` 通道的来源)。
pub(crate) fn subscribe_background(agent: &MinimalAgent) -> broadcast::Receiver<(ThreadId, Event)> {
    agent.inner.background_tx.subscribe()
}

/// 会话广播发送方句柄（MCP/LSP 生命周期事件反向推送用）。
pub(crate) fn session_tx(agent: &MinimalAgent) -> broadcast::Sender<Event> {
    agent.inner.session_tx.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_protocol::EventMsg;

    #[tokio::test]
    async fn background_thread_events_route_to_background_channel() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        // 先绑到 old_sid(install 占位线程被取消 —— 无会话可保活,旧行为),
        // 再切到新会话:old_sid 线程降级后台(不 cancel)。
        let old_sid = reflect_protocol::ThreadId::new();
        super::super::rebind::rebind_session(&agent, old_sid, vec![], None).unwrap();
        let old = agent.inner.thread.lock().clone().unwrap();
        let mut foreground = agent.inner.session_tx.subscribe();
        let mut background = agent.inner.background_tx.subscribe();
        // 前台事件照常进 session_tx。
        route_event(&agent.inner, &old, Some(old_sid), event());
        assert!(foreground.try_recv().is_ok());
        // 换绑到新会话:旧线程降级后台(不 cancel)。
        super::super::rebind::rebind_session(
            &agent,
            reflect_protocol::ThreadId::new(),
            vec![],
            None,
        )
        .unwrap();
        while foreground.try_recv().is_ok() {}
        assert!(!old.cancel_token().is_cancelled(), "降级线程不得被 cancel");
        // 旧(后台)线程事件:不进前台通道,带 sid 进后台通道。
        route_event(&agent.inner, &old, Some(old_sid), event());
        assert!(foreground.try_recv().is_err());
        let (bg_sid, _bg_event) = background.try_recv().expect("后台通道必须收到事件");
        assert_eq!(bg_sid, old_sid);
        // sid = None 的占位线程:非前台仍丢弃(旧行为)。
        route_event(&agent.inner, &old, None, event());
        assert!(background.try_recv().is_err());
        // promote 回旧会话后,该线程重回前台通道。
        super::super::rebind::rebind_session(&agent, old_sid, vec![], None).unwrap();
        let current = agent.inner.thread.lock().clone().unwrap();
        assert!(
            Arc::ptr_eq(&current, &old),
            "bind 回后台会话必须 promote 同一线程"
        );
        route_event(&agent.inner, &old, Some(old_sid), event());
        assert!(foreground.try_recv().is_ok());
    }

    /// `background_running` 随 turn 生命周期维护(turn_started 插入,
    /// complete/aborted 移除),promote 时移除表项。
    #[tokio::test]
    async fn background_running_tracks_turn_lifecycle() {
        use reflect_protocol::{TurnId, TurnStartedEvent};
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let sid = reflect_protocol::ThreadId::new();
        track_running(
            &agent.inner,
            Some(sid),
            &Event::new(
                "",
                EventMsg::TurnStarted(TurnStartedEvent {
                    turn_id: TurnId::new(),
                    user_message_id: None,
                }),
            ),
        );
        assert!(agent.inner.background_running.lock().contains(&sid));
        track_running(
            &agent.inner,
            Some(sid),
            &Event::new(
                "",
                EventMsg::TurnAborted(reflect_protocol::TurnAbortedEvent {
                    turn_id: TurnId::new(),
                    reason: reflect_protocol::AbortReason::Shutdown,
                }),
            ),
        );
        assert!(!agent.inner.background_running.lock().contains(&sid));
    }

    fn event() -> Event {
        Event::new("test", EventMsg::ShutdownComplete)
    }
}
