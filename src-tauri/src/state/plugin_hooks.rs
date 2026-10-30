//! 在线程启动前安装插件事件桥，等待插件挂载后再转发事件。

use std::sync::Arc;

use async_trait::async_trait;
use reflect_core::AgentThread;
use reflect_hooks::{Hook, HookDecision, HookEngine, HookError, HookEvent, HookEventKind};
use reflect_protocol::ThreadId;
use std::sync::Weak;
use std::sync::atomic::{AtomicU8, Ordering};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub(crate) const FORWARDER_NAME: &str = "desktop_plugin_hook_forwarder";

pub(crate) struct PluginHookSlot {
    pub(crate) thread: Weak<AgentThread>,
    pub(crate) bridge: Arc<PluginHookBridge>,
    pub(crate) activate: watch::Sender<bool>,
}

pub(crate) struct PluginHookBridge {
    pub(crate) engine: Arc<HookEngine>,
    ready: watch::Receiver<bool>,
    cancel: CancellationToken,
    session_id: ThreadId,
    // 0 = pending, 1 = started, 2 = cancelled before start.
    start_state: AtomicU8,
    start_done: watch::Sender<bool>,
    ended: tokio::sync::Mutex<bool>,
    pub(crate) reload_gate: tokio::sync::RwLock<()>,
}

impl PluginHookBridge {
    pub(crate) fn new(
        session_id: ThreadId,
        cancel: CancellationToken,
    ) -> (Arc<Self>, watch::Sender<bool>) {
        let (sender, ready) = watch::channel(false);
        let (start_done, _) = watch::channel(false);
        (
            Arc::new(Self {
                engine: Arc::new(HookEngine::new()),
                ready,
                cancel,
                session_id,
                start_state: AtomicU8::new(0),
                start_done,
                ended: tokio::sync::Mutex::new(false),
                reload_gate: tokio::sync::RwLock::new(()),
            }),
            sender,
        )
    }

    pub(crate) async fn wait_ready(&self) -> anyhow::Result<()> {
        let mut ready = self.ready.clone();
        if !*ready.borrow_and_update() {
            tokio::select! {
                result = ready.changed() => result.map_err(|_| anyhow::anyhow!("plugin mount ended before becoming ready"))?,
                _ = self.cancel.cancelled() => anyhow::bail!("session closed before plugin mount completed"),
            }
        }
        if !*ready.borrow_and_update() {
            anyhow::bail!("plugin mount is not ready");
        }
        Ok(())
    }

    async fn dispatch(&self, event: &HookEvent) -> HookDecision {
        if matches!(event, HookEvent::SessionStart { .. }) {
            let result = if self.wait_ready().await.is_ok()
                && !self.cancel.is_cancelled()
                && self
                    .start_state
                    .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                let _gate = self.reload_gate.read().await;
                self.engine.dispatch(event).await
            } else {
                HookDecision::Allow
            };
            self.start_done.send_replace(true);
            return result;
        }
        if matches!(event, HookEvent::SessionEnd { .. }) {
            return self.finish_event(event).await;
        }
        self.wait_start().await;
        if self.start_state.load(Ordering::Acquire) != 1 {
            return HookDecision::Allow;
        }
        let _gate = self.reload_gate.read().await;
        self.engine.dispatch(event).await
    }

    async fn wait_start(&self) {
        let mut done = self.start_done.subscribe();
        if !*done.borrow_and_update() {
            tokio::select! {
                _ = done.changed() => return,
                _ = self.cancel.cancelled() => {
                    if self.start_state.compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire) != Err(1) {
                        return;
                    }
                }
            }
            let _ = done.changed().await;
        }
    }

    async fn finish_event(&self, event: &HookEvent) -> HookDecision {
        self.wait_start().await;
        let mut ended = self.ended.lock().await;
        if *ended {
            return HookDecision::Allow;
        }
        let result = if self.start_state.load(Ordering::Acquire) == 1 {
            let _gate = self.reload_gate.read().await;
            self.engine.dispatch(event).await
        } else {
            HookDecision::Allow
        };
        *ended = true;
        result
    }

    pub(crate) async fn finish(&self) {
        let _ = self
            .finish_event(&HookEvent::SessionEnd {
                session_id: self.session_id,
                reason: "closed".into(),
            })
            .await;
    }
}

pub(crate) struct PluginHookForwarder(pub(crate) Arc<PluginHookBridge>);

#[async_trait]
impl Hook for PluginHookForwarder {
    fn name(&self) -> &str {
        FORWARDER_NAME
    }

    fn events(&self) -> &[HookEventKind] {
        &[
            HookEventKind::PreToolUse,
            HookEventKind::PostToolUse,
            HookEventKind::PostToolUseFailure,
            HookEventKind::Stop,
            HookEventKind::SessionStart,
            HookEventKind::UserPromptSubmit,
            HookEventKind::PreCompact,
            HookEventKind::PostCompact,
            HookEventKind::SessionEnd,
            HookEventKind::TaskCreated,
            HookEventKind::TaskCompleted,
            HookEventKind::TaskUpdated,
        ]
    }

    async fn handle(&self, event: &HookEvent) -> Result<HookDecision, HookError> {
        Ok(self.0.dispatch(event).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct LifecycleCounter {
        starts: Arc<AtomicUsize>,
        ends: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl Hook for LifecycleCounter {
        fn name(&self) -> &str {
            "lifecycle_counter"
        }
        fn events(&self) -> &[HookEventKind] {
            &[HookEventKind::SessionStart, HookEventKind::SessionEnd]
        }
        async fn handle(&self, event: &HookEvent) -> Result<HookDecision, HookError> {
            match event {
                HookEvent::SessionStart { .. } => {
                    self.starts.fetch_add(1, Ordering::SeqCst);
                }
                HookEvent::SessionEnd { .. } => {
                    self.ends.fetch_add(1, Ordering::SeqCst);
                }
                _ => {}
            }
            Ok(HookDecision::Allow)
        }
    }

    #[tokio::test]
    async fn start_waits_for_mount_and_end_is_delivered_once() {
        let sid = ThreadId::new();
        let (bridge, ready) = PluginHookBridge::new(sid, CancellationToken::new());
        let starts = Arc::new(AtomicUsize::new(0));
        let ends = Arc::new(AtomicUsize::new(0));
        bridge.engine.register(LifecycleCounter {
            starts: starts.clone(),
            ends: ends.clone(),
        });
        let event = HookEvent::SessionStart {
            session_id: sid,
            config: serde_json::json!({}),
        };
        let startup = tokio::spawn({
            let bridge = bridge.clone();
            async move { bridge.dispatch(&event).await }
        });
        tokio::task::yield_now().await;
        assert_eq!(starts.load(Ordering::SeqCst), 0);
        ready.send_replace(true);
        startup.await.unwrap();
        assert_eq!(starts.load(Ordering::SeqCst), 1);
        let end_event = HookEvent::SessionEnd {
            session_id: sid,
            reason: "shutdown".into(),
        };
        tokio::join!(bridge.finish(), bridge.dispatch(&end_event));
        assert_eq!(ends.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancellation_before_mount_releases_waiters_without_lifecycle_events() {
        let sid = ThreadId::new();
        let cancel = CancellationToken::new();
        let (bridge, _ready) = PluginHookBridge::new(sid, cancel.clone());
        let starts = Arc::new(AtomicUsize::new(0));
        let ends = Arc::new(AtomicUsize::new(0));
        bridge.engine.register(LifecycleCounter {
            starts: starts.clone(),
            ends: ends.clone(),
        });
        let startup = tokio::spawn({
            let bridge = bridge.clone();
            async move {
                bridge
                    .dispatch(&HookEvent::SessionStart {
                        session_id: sid,
                        config: serde_json::json!({}),
                    })
                    .await
            }
        });
        cancel.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(2), startup)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            tokio::join!(bridge.finish(), bridge.finish());
        })
        .await
        .unwrap();
        assert_eq!(starts.load(Ordering::SeqCst), 0);
        assert_eq!(ends.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn cancellation_before_start_dispatch_releases_finish() {
        let sid = ThreadId::new();
        let cancel = CancellationToken::new();
        let (bridge, ready) = PluginHookBridge::new(sid, cancel.clone());
        ready.send_replace(true);
        cancel.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(2), bridge.finish())
            .await
            .unwrap();
        bridge
            .dispatch(&HookEvent::SessionStart {
                session_id: sid,
                config: serde_json::json!({}),
            })
            .await;
        assert_ne!(bridge.start_state.load(Ordering::Acquire), 1);
    }

    #[tokio::test]
    async fn reload_blocks_dispatch_until_preferences_are_restored() {
        let sid = ThreadId::new();
        let (bridge, ready) = PluginHookBridge::new(sid, CancellationToken::new());
        let starts = Arc::new(AtomicUsize::new(0));
        bridge.engine.register(LifecycleCounter {
            starts: starts.clone(),
            ends: Arc::new(AtomicUsize::new(0)),
        });
        let gate = bridge.reload_gate.write().await;
        ready.send_replace(true);
        let startup = tokio::spawn({
            let bridge = bridge.clone();
            async move {
                bridge
                    .dispatch(&HookEvent::SessionStart {
                        session_id: sid,
                        config: serde_json::json!({}),
                    })
                    .await
            }
        });
        tokio::task::yield_now().await;
        assert_eq!(starts.load(Ordering::SeqCst), 0);
        bridge.engine.disable("lifecycle_counter");
        drop(gate);
        startup.await.unwrap();
        assert_eq!(starts.load(Ordering::SeqCst), 0);
    }
}
