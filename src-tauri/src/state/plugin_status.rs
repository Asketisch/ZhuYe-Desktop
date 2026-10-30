//! 当前插件运行时的加载快照；所有读写由 plugin_mount_lock 串行化。
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use parking_lot::Mutex;
use reflect_protocol::{Event, EventMsg, PluginLoadedEvent};
use tokio::sync::{broadcast, mpsc, watch};

const BARRIER_PREFIX: &str = "desktop-plugin-status-barrier-";

pub(crate) struct PluginStatus {
    pub(crate) events: mpsc::Sender<Event>,
    loaded: Arc<Mutex<HashMap<String, PluginLoadedEvent>>>,
    barrier: watch::Receiver<u64>,
    next_barrier: AtomicU64,
}

impl PluginStatus {
    pub(crate) fn new(broadcast: broadcast::Sender<Event>) -> Arc<Self> {
        let (events, mut receiver) = mpsc::channel::<Event>(32);
        let (barrier_tx, barrier) = watch::channel(0_u64);
        let loaded = Arc::new(Mutex::new(HashMap::new()));
        let task_loaded = loaded.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                if let Some(sequence) = event
                    .id
                    .strip_prefix(BARRIER_PREFIX)
                    .and_then(|id| id.parse::<u64>().ok())
                {
                    barrier_tx.send_replace(sequence);
                    continue;
                }
                if let EventMsg::PluginLoaded(info) = &event.msg {
                    task_loaded.lock().insert(info.plugin.clone(), info.clone());
                }
                let _ = broadcast.send(event);
            }
        });
        Arc::new(Self {
            events,
            loaded,
            barrier,
            next_barrier: AtomicU64::new(0),
        })
    }

    async fn drain(&self) -> anyhow::Result<()> {
        let mut barrier = self.barrier.clone();
        let target = self.next_barrier.fetch_add(1, Ordering::Relaxed) + 1;
        self.events
            .send(Event::new(
                format!("{BARRIER_PREFIX}{target}"),
                EventMsg::ShutdownComplete,
            ))
            .await?;
        while *barrier.borrow_and_update() < target {
            barrier.changed().await?;
        }
        Ok(())
    }

    pub(crate) async fn snapshot(&self) -> anyhow::Result<HashMap<String, PluginLoadedEvent>> {
        self.drain().await?;
        Ok(self.loaded.lock().clone())
    }

    pub(crate) async fn retain_enabled(&self, enabled: &[String]) -> anyhow::Result<()> {
        self.drain().await?;
        self.loaded.lock().retain(|id, _| enabled.contains(id));
        Ok(())
    }

    pub(crate) async fn clear(&self) -> anyhow::Result<()> {
        self.drain().await?;
        self.loaded.lock().clear();
        Ok(())
    }
}
