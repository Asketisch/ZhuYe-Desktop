//! Activity 审计 —— 实现已收编进上游 `reflect_telemetry::activity`
//! （类型 / 存储 / rotate / `map_event` / `pump_events` 全部为上游单一
//! 事实源，语义逐字一致）。本模块只保留桌面侧需要的补充：
//!
//! - [`ActivityLog`]：共享句柄，支持「清空内存缓冲」（Inbox 清空按钮）。
//!   上游 `ActivityLogger` 没有该入口，桌面端以「原地换新 logger」实现
//!   —— 磁盘 append-only 文件不动，rotate 计数由上游从文件长度续算。
//! - 全量再导出上游类型，消费方 import 路径不变。

pub use reflect_telemetry::activity::{
    ActivityEvent, ActivityFilter, ActivityKind, ActivityLevel, ActivityLogger, map_event,
    pump_events,
};

use parking_lot::RwLock;
use std::sync::Arc;

/// 共享的 activity logger 句柄（可原地换新，支持清空内存缓冲）。
pub struct ActivityLog {
    current: RwLock<Arc<ActivityLogger>>,
    persist: bool,
}

impl Default for ActivityLog {
    fn default() -> Self {
        Self {
            current: RwLock::new(Arc::new(ActivityLogger::in_memory())),
            persist: false,
        }
    }
}

impl std::fmt::Debug for ActivityLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActivityLog")
            .field("len", &self.len())
            .finish_non_exhaustive()
    }
}

impl ActivityLog {
    /// 默认构造：落盘 `<data_dir>/activity/activity.jsonl`
    /// （HOME 缺失时上游退化为纯内存，审计不阻断启动）。
    pub fn with_default_home() -> Arc<Self> {
        Arc::new(Self {
            current: RwLock::new(ActivityLogger::with_default_home()),
            persist: true,
        })
    }

    /// 纯内存构造：清空或重建时都不会创建审计文件。
    pub fn in_memory() -> Arc<Self> {
        Self::wrap(Arc::new(ActivityLogger::in_memory()))
    }

    /// 包一个已有 logger（测试注入）。
    pub fn wrap(logger: Arc<ActivityLogger>) -> Arc<Self> {
        Arc::new(Self {
            current: RwLock::new(logger),
            persist: false,
        })
    }

    /// 当前 logger（订阅任务逐事件取用，清空后自动写进新实例）。
    pub fn get(&self) -> Arc<ActivityLogger> {
        Arc::clone(&self.current.read())
    }

    /// 清空内存缓冲（磁盘审计文件不动）。
    pub fn clear_memory(&self) {
        *self.current.write() = if self.persist {
            ActivityLogger::with_default_home()
        } else {
            Arc::new(ActivityLogger::in_memory())
        };
    }

    /// 记录一条（代理到当前 logger）。
    pub fn record(&self, event: ActivityEvent) -> std::io::Result<()> {
        self.get().record(event)
    }

    /// 当前内存缓冲条数（诊断用）。
    pub fn len(&self) -> usize {
        self.get().len()
    }

    /// 是否为空。
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_protocol::Actor;

    #[test]
    fn clear_memory_swaps_to_a_fresh_buffer() {
        let log = ActivityLog::in_memory();
        let event = ActivityEvent::new(
            ActivityKind::AgentMessage,
            Actor::user(),
            "x",
            ActivityLevel::Info,
        );
        log.record(event).unwrap();
        assert_eq!(log.len(), 1);
        log.clear_memory();
        assert!(log.is_empty());
        // 清空后 record 仍可达（订阅任务持有的是句柄，不是旧实例）。
        let event = ActivityEvent::new(
            ActivityKind::AgentMessage,
            Actor::user(),
            "y",
            ActivityLevel::Info,
        );
        log.record(event).unwrap();
        assert_eq!(log.len(), 1);
    }

    #[test]
    fn upstream_map_event_is_reachable() {
        use reflect_protocol::{Event, EventMsg, TurnStartedEvent};
        let e = Event {
            id: "evt".into(),
            msg: EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: reflect_protocol::TurnId::new(),
                user_message_id: None,
            }),
        };
        assert!(map_event(&e).is_some());
    }
}
