//! 协调同一会话的新旧线程写入，确保删除和归档后不再落盘。

use std::sync::{Arc, Weak};

use async_trait::async_trait;
use reflect_protocol::{
    RolloutError, RolloutRecord, RolloutRecorder, SessionInfo, ThreadId, TurnId,
};
use tokio::sync::RwLock;

use super::MinimalAgent;

#[derive(Debug)]
pub(crate) struct RecorderGate {
    enabled: RwLock<bool>,
}

impl RecorderGate {
    fn new() -> Self {
        Self {
            enabled: RwLock::new(true),
        }
    }

    async fn deactivate(&self) {
        *self.enabled.write().await = false;
    }

    /// 持有读锁直到该会话的文件操作完成，删除/归档会等待它退出。
    pub(crate) async fn acquire(&self) -> anyhow::Result<tokio::sync::RwLockReadGuard<'_, bool>> {
        let enabled = self.enabled.read().await;
        if !*enabled {
            anyhow::bail!("session recorder is closed");
        }
        Ok(enabled)
    }
}

pub(crate) fn gate_for(agent: &MinimalAgent, id: ThreadId) -> Arc<RecorderGate> {
    let mut gates = agent.inner.recorder_gates.lock();
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(&id).and_then(Weak::upgrade) {
        return gate;
    }
    let gate = Arc::new(RecorderGate::new());
    gates.insert(id, Arc::downgrade(&gate));
    gate
}

/// 调用方必须持有会话切换锁，直到删除或归档完成。
pub(crate) async fn deactivate_session(
    agent: &MinimalAgent,
    id: ThreadId,
) -> Option<reflect_protocol::PermissionMode> {
    let mode = if agent.bound_session_id() == Some(id) {
        let mode = agent
            .inner
            .thread
            .lock()
            .as_ref()
            .map(|thread| thread.config().permission_mode());
        if let Some(thread) = agent.inner.thread.lock().as_ref() {
            thread.cancel_token().cancel();
        }
        *agent.inner.bound_session_id.lock() = None;
        if let Some(mut driver) = agent.inner.cron_driver.lock().take() {
            driver.stop();
        }
        if let Some(scheduler) = agent.inner.cron_scheduler.write().as_mut() {
            scheduler.rebind_sender(None);
        }
        mode
    } else {
        None
    };
    let gate = agent
        .inner
        .recorder_gates
        .lock()
        .remove(&id)
        .and_then(|gate| gate.upgrade());
    if let Some(gate) = gate {
        gate.deactivate().await;
    }
    mode
}

#[derive(Debug)]
pub(crate) struct GuardedRecorder {
    inner: Arc<dyn RolloutRecorder>,
    gate: Arc<RecorderGate>,
}

impl GuardedRecorder {
    pub(crate) fn new(inner: impl RolloutRecorder + 'static, gate: Arc<RecorderGate>) -> Self {
        Self {
            inner: Arc::new(inner),
            gate,
        }
    }
}

#[async_trait]
impl RolloutRecorder for GuardedRecorder {
    async fn record(&self, record: RolloutRecord) -> Result<(), RolloutError> {
        let enabled = self.gate.enabled.read().await;
        if !*enabled {
            return Err(RolloutError::Io(std::io::Error::other(
                "session recorder is closed",
            )));
        }
        let result = self.inner.record(record).await;
        drop(enabled);
        result
    }

    async fn replay(&self, id: ThreadId) -> Result<Vec<RolloutRecord>, RolloutError> {
        self.inner.replay(id).await
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, RolloutError> {
        self.inner.list_sessions().await
    }

    async fn truncate_after(&self, id: Option<&TurnId>) -> Result<usize, RolloutError> {
        let enabled = self.gate.enabled.read().await;
        if !*enabled {
            return Err(RolloutError::Io(std::io::Error::other(
                "session recorder is closed",
            )));
        }
        let result = self.inner.truncate_after(id).await;
        drop(enabled);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct BlockingRecorder {
        started: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    }

    #[async_trait]
    impl RolloutRecorder for BlockingRecorder {
        async fn record(&self, _: RolloutRecord) -> Result<(), RolloutError> {
            self.started.notify_one();
            self.release.notified().await;
            Ok(())
        }
        async fn replay(&self, _: ThreadId) -> Result<Vec<RolloutRecord>, RolloutError> {
            Ok(vec![])
        }
        async fn list_sessions(&self) -> Result<Vec<SessionInfo>, RolloutError> {
            Ok(vec![])
        }
        async fn truncate_after(&self, _: Option<&TurnId>) -> Result<usize, RolloutError> {
            Ok(0)
        }
    }

    #[tokio::test]
    async fn deletion_waits_for_existing_writes_and_closes_all_shared_recorders() {
        let agent = MinimalAgent::new_empty();
        let id = ThreadId::new();
        let first = gate_for(&agent, id);
        let second = gate_for(&agent, id);
        assert!(Arc::ptr_eq(&first, &second));
        let recorder = GuardedRecorder::new(reflect_protocol::NullRecorder, second);
        let write_in_progress = first.acquire().await.unwrap();
        let deleting = {
            let agent = agent.clone();
            tokio::spawn(async move { deactivate_session(&agent, id).await })
        };
        tokio::task::yield_now().await;
        assert!(!deleting.is_finished());
        drop(write_in_progress);
        deleting.await.unwrap();
        assert!(first.acquire().await.is_err());
        assert!(recorder.truncate_after(None).await.is_err());
        let record = RolloutRecord::SessionMeta {
            session_id: id,
            model: "test".into(),
            started_at: chrono::Utc::now(),
            workspace: None,
        };
        assert!(recorder.record(record).await.is_err());
        assert!(!Arc::ptr_eq(&first, &gate_for(&agent, id)));
    }

    #[tokio::test]
    async fn deletion_waits_for_the_underlying_record_call() {
        let agent = MinimalAgent::new_empty();
        let id = ThreadId::new();
        let gate = gate_for(&agent, id);
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let recorder = Arc::new(GuardedRecorder::new(
            BlockingRecorder {
                started: started.clone(),
                release: release.clone(),
            },
            gate,
        ));
        let writer = {
            let recorder = recorder.clone();
            tokio::spawn(async move {
                recorder
                    .record(RolloutRecord::SessionMeta {
                        session_id: id,
                        model: "test".into(),
                        started_at: chrono::Utc::now(),
                        workspace: None,
                    })
                    .await
            })
        };
        started.notified().await;
        let deleting = {
            let agent = agent.clone();
            tokio::spawn(async move { deactivate_session(&agent, id).await })
        };
        tokio::task::yield_now().await;
        assert!(!deleting.is_finished());
        release.notify_one();
        writer.await.unwrap().unwrap();
        deleting.await.unwrap();
        assert!(recorder.truncate_after(None).await.is_err());
    }
}
