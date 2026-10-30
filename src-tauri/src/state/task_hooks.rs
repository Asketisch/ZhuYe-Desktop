//! 将共享 TaskManager 的生命周期事件转发到当前线程的 HookEngine。

use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;
use reflect_hooks::{Hook, HookDecision, HookEngine, HookError, HookEvent, HookEventKind};

pub(crate) type HookTarget = Arc<RwLock<Option<Arc<HookEngine>>>>;

pub(crate) fn task_hook_bridge() -> (Arc<HookEngine>, HookTarget) {
    let target = Arc::new(RwLock::new(None));
    let bridge = Arc::new(HookEngine::new());
    bridge.register(TaskHookForwarder {
        target: target.clone(),
    });
    (bridge, target)
}

struct TaskHookForwarder {
    target: HookTarget,
}

#[async_trait]
impl Hook for TaskHookForwarder {
    fn name(&self) -> &str {
        "desktop_task_hook_forwarder"
    }

    fn events(&self) -> &[HookEventKind] {
        &[
            HookEventKind::TaskCreated,
            HookEventKind::TaskCompleted,
            HookEventKind::TaskUpdated,
        ]
    }

    async fn handle(&self, event: &HookEvent) -> Result<HookDecision, HookError> {
        let target = self.target.read().clone();
        match target {
            Some(engine) => Ok(engine.dispatch(event).await),
            None => Ok(HookDecision::Allow),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Counter(Arc<AtomicUsize>);

    #[async_trait]
    impl Hook for Counter {
        fn name(&self) -> &str {
            "task_counter"
        }
        fn events(&self) -> &[HookEventKind] {
            &[HookEventKind::TaskCreated]
        }
        async fn handle(&self, _: &HookEvent) -> Result<HookDecision, HookError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(HookDecision::Allow)
        }
    }

    #[tokio::test]
    async fn task_manager_uses_current_engine_after_switch() {
        let dir = tempfile::tempdir().unwrap();
        let (bridge, target) = task_hook_bridge();
        let manager = reflect_task::TaskManager::new(
            Arc::new(reflect_task::FileTaskStore::new(dir.path())),
            Arc::new(reflect_task::FileTeamStore::new(dir.path())),
        )
        .with_hook_engine(bridge);
        let first_count = Arc::new(AtomicUsize::new(0));
        let first = Arc::new(HookEngine::new());
        first.register(Counter(first_count.clone()));
        *target.write() = Some(first);
        manager
            .create_task(
                &"test".into(),
                "one".into(),
                "".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        let second_count = Arc::new(AtomicUsize::new(0));
        let second = Arc::new(HookEngine::new());
        second.register(Counter(second_count.clone()));
        *target.write() = Some(second.clone());
        manager
            .create_task(
                &"test".into(),
                "two".into(),
                "".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        assert_eq!(first_count.load(Ordering::SeqCst), 1);
        assert_eq!(second_count.load(Ordering::SeqCst), 1);
        second.disable("task_counter");
        manager
            .create_task(
                &"test".into(),
                "three".into(),
                "".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        assert_eq!(second_count.load(Ordering::SeqCst), 1);
    }
}
