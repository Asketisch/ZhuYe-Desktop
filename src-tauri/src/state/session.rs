//! Session-level broadcast 入口:forwarder 启动 + `subscribe_session` /
//! `session_tx` 句柄。
//!
//! 所有 Tauri command / webview 共享同一个 `broadcast::Sender<Event>`;
//! `start_forwarder` 把 `AgentThread::subscribe_session()` 的 mpsc 流
//! 持续 `recv().await` 并 fan-out 到 broadcast。

use reflect_protocol::Event;
use std::sync::Arc;
use tokio::sync::broadcast;

use super::MinimalAgent;

/// 只转发当前线程的事件；检查和发送之间持有槽锁，避免重绑时混入旧事件。
pub(crate) fn publish_if_current(
    inner: &super::agent::MinimalAgentInner,
    thread: &Arc<reflect_core::AgentThread>,
    event: Event,
) {
    let current = inner.thread.lock();
    if current
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(active, thread))
    {
        let _ = inner.session_tx.send(event);
    }
}

/// 启动 session 事件转发:从 `AgentThread::subscribe_session()` 拿 mpsc::Receiver,
/// 持续 `recv().await` 并 broadcast 到所有 Tauri 订阅者。
///
/// 在 `install_agent_thread` 内部调用,外部不应直接调。
pub(crate) fn start_forwarder(agent: &MinimalAgent) {
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
            publish_if_current(&inner, &thread, event);
        }
        tracing::warn!("[reflect-gui] session forward task exited (AgentThread closed)");
    });
}

/// 订阅 session 级 broadcast。前端 Tauri listener 拿到的就是这个 receiver。
pub(crate) fn subscribe_session(agent: &MinimalAgent) -> broadcast::Receiver<Event> {
    agent.inner.session_tx.subscribe()
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
    async fn ignores_events_from_a_replaced_thread() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let old = agent.inner.thread.lock().clone().unwrap();
        let mut events = agent.inner.session_tx.subscribe();
        let event = || Event::new("test", EventMsg::ShutdownComplete);
        publish_if_current(&agent.inner, &old, event());
        assert!(events.try_recv().is_ok());
        super::super::rebind::rebind_session(
            &agent,
            reflect_protocol::ThreadId::new(),
            vec![],
            None,
        )
        .unwrap();
        while events.try_recv().is_ok() {}
        publish_if_current(&agent.inner, &old, event());
        assert!(events.try_recv().is_err());
        let current = agent.inner.thread.lock().clone().unwrap();
        publish_if_current(&agent.inner, &current, event());
        assert!(events.try_recv().is_ok());
    }
}
