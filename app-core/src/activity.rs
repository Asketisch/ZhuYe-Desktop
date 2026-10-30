//! Activity 时间线 —— 本地事件审计日志（Phase 3 条目 9）。
//!
//! 记录“谁（actor）在何时（ts）做了什么事（kind + summary）”，供 Inbox / Activity
//! timeline / @mention 搜索使用。参考通用 activity_log 设计，但
//! ReflectDesktop 无 DB，写入 JSONL 文件和内存环形缓冲。
//!
//! ## 数据源
//!
//! `ActivityLogger` 不主动订阅事件；由调用方（`install_agent_thread`）把
//! `reflect_protocol::Event` 映射成 [`ActivityEvent`] 后调用 [`ActivityLogger::record`]。
//! 这样保持 app-core 对 tokio runtime / tauri 的零依赖。
//!
//! ## 存储
//!
//! - 内存：`VecDeque` 环形缓冲，cap = [`CAP_INMEMORY`]，LRU 驱逐最旧。
//! - 磁盘：`~/.zhuye/activity/activity.jsonl` 追加写入；单文件超过
//!   [`ROTATE_BYTES`] 时 rotate 为 `activity.<ts>.jsonl` 并开启新文件。
//!
//! ## 线程安全
//!
//! 全部实现 `Send + Sync`，内部使用 `parking_lot::Mutex`。`record` 非阻塞（磁盘写
//! 在持有锁期间同步完成，但单条 JSONL < 1KB，可接受）。

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::actor::Actor;

/// 内存环形缓冲容量。
pub const CAP_INMEMORY: usize = 500;

/// 单 JSONL 文件 rotate 阈值(1 MB)。
pub const ROTATE_BYTES: u64 = 1024 * 1024;

/// 事件等级(供 UI 颜色/过滤)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityLevel {
    /// 普通信息。
    Info,
    /// 警告(approval pending / 降级)。
    Warn,
    /// 错误(stream error / 工具失败)。
    Error,
}

impl ActivityLevel {
    /// `"info"` / `"warn"` / `"error"`。
    pub fn as_str(self) -> &'static str {
        match self {
            ActivityLevel::Info => "info",
            ActivityLevel::Warn => "warn",
            ActivityLevel::Error => "error",
        }
    }
}

impl std::fmt::Display for ActivityLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 事件种类白名单(snake_case 字符串)。
///
/// 与 `reflect_protocol::EventMsg` 的 variant 一一映射,但展开成更细的
/// task/team 相关种类(`task_created` / `task_completed` / `team_created`)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    /// Turn 开始 / 结束 / 中断。
    TurnStarted,
    /// Turn 完成。
    TurnComplete,
    /// Turn 被中断。
    TurnAborted,
    /// Agent 发了消息。
    AgentMessage,
    /// 工具调用开始。
    ToolCallBegin,
    /// 工具调用结束。
    ToolCallEnd,
    /// 需要审批。
    ApprovalRequest,
    /// Plan 请求 / 就绪。
    PlanRequest,
    /// Plan 已批准。
    PlanApproved,
    /// Plan 被拒。
    PlanRejected,
    /// 任务被创建。
    TaskCreated,
    /// 任务被完成。
    TaskCompleted,
    /// 任务被更新。
    TaskUpdated,
    /// 任务被认领。
    TaskClaimed,
    /// Team/Squad 被创建。
    TeamCreated,
    /// Team/Squad 被删除。
    TeamDeleted,
    /// 提到某 actor(`@<id>`)。
    Mention,
    /// 错误事件。
    Error,
    /// Session 配置变更。
    SessionConfigured,
    /// 权限模式变更。
    PermissionModeChanged,
    /// MCP server 启动 / 失败。
    McpServer,
    /// LSP server 启动 / 失败。
    LspServer,
    /// 上下文压缩。
    ContextCompacted,
    /// 其他未归类事件(原始 `EventMsg.type` 字符串放 summary)。
    Other,
}

/// 单条 activity 事件。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    /// 稳定 id(`act-<8 hex>` 或递增整数字符串)。
    pub id: String,
    /// 毫秒级时间戳(自 UNIX_EPOCH)。
    pub ts_ms: u64,
    /// 事件种类。
    pub kind: ActivityKind,
    /// 触发者(谁做的)。
    pub actor: Actor,
    /// 人类可读摘要(UI 主文本)。
    pub summary: String,
    /// 关联 task id(若事件源于 task)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<u32>,
    /// 关联 team/squad 名(若事件源于 squad)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
    /// 等级。
    pub level: ActivityLevel,
}

/// 过滤条件(全部 `Option`,None = 不过滤该项)。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilter {
    /// 按种类过滤。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ActivityKind>,
    /// 按等级过滤。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<ActivityLevel>,
    /// 按 actorId 过滤(`"user"` / `"team-lead@rocket"` 等)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    /// 按 team 名过滤。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
    /// 只返回 `ts_ms >= since_ms` 的事件。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_ms: Option<u64>,
    /// 最多返回条数(默认 100)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

impl ActivityFilter {
    /// 事件是否匹配过滤条件。
    pub fn matches(&self, e: &ActivityEvent) -> bool {
        if let Some(k) = &self.kind {
            if &e.kind != k {
                return false;
            }
        }
        if let Some(l) = &self.level {
            if &e.level != l {
                return false;
            }
        }
        if let Some(aid) = &self.actor_id {
            if &e.actor.actor_id != aid {
                return false;
            }
        }
        if let Some(tn) = &self.team_name {
            if e.actor.team_name.as_deref() != Some(tn.as_str())
                && e.team_name.as_deref() != Some(tn.as_str())
            {
                return false;
            }
        }
        if let Some(since) = self.since_ms {
            if e.ts_ms < since {
                return false;
            }
        }
        true
    }
}

/// Activity 日志错误。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityError {
    /// IO 错误(磁盘读写失败)。
    IoError {
        /// 错误消息。
        message: String,
    },
    /// 序列化错误。
    SerializeError {
        /// 错误消息。
        message: String,
    },
    /// 路径无效。
    InvalidPath {
        /// 错误消息。
        message: String,
    },
}

impl ActivityError {
    fn io(e: std::io::Error) -> Self {
        ActivityError::IoError {
            message: e.to_string(),
        }
    }
    fn ser(e: serde_json::Error) -> Self {
        ActivityError::SerializeError {
            message: e.to_string(),
        }
    }
}

impl std::fmt::Display for ActivityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActivityError::IoError { message } => write!(f, "activity io error: {message}"),
            ActivityError::SerializeError { message } => {
                write!(f, "activity serialize error: {message}")
            }
            ActivityError::InvalidPath { message } => write!(f, "activity invalid path: {message}"),
        }
    }
}

impl std::error::Error for ActivityError {}

struct Inner {
    /// 环形缓冲(最新在尾)。
    buf: VecDeque<ActivityEvent>,
    /// 当前 JSONL 文件句柄(append 模式)。
    file: Option<BufWriter<File>>,
    /// 当前文件已写字节(用于 rotate 判定)。
    written_bytes: u64,
    /// 自增 id 计数器。
    next_seq: u64,
}

impl Inner {
    fn new() -> Self {
        Self {
            buf: VecDeque::with_capacity(CAP_INMEMORY),
            file: None,
            written_bytes: 0,
            next_seq: 1,
        }
    }
}

/// Activity 日志管理器。
pub struct ActivityLogger {
    root: PathBuf,
    inner: Mutex<Inner>,
}

impl ActivityLogger {
    /// 用指定 root 目录构造(不立即打开文件,lazy open)。
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            inner: Mutex::new(Inner::new()),
        }
    }

    /// 默认 home:`~/.zhuye/activity/`。
    pub fn with_default_home() -> Self {
        let root = crate::paths::user_data_path_or_relative(&["activity"]);
        Self::new(root)
    }

    /// 测试用:纯内存,不写磁盘。
    pub fn in_memory() -> Self {
        let mut l = Self::new(PathBuf::from("/tmp/reflect-activity-disabled"));
        // 标记:用 root 指向不存在的特殊路径,open 时会失败但 record 不 panic。
        l.root = PathBuf::from("");
        l
    }

    /// 记录一条事件(同步写磁盘 + 推入环形缓冲)。
    ///
    /// 磁盘写失败仅 `tracing::warn!`，不影响内存缓冲（磁盘尽力而为）。
    pub fn record(&self, mut event: ActivityEvent) -> ActivityResult<()> {
        let mut inner = self.inner.lock();
        // 分配 id(若调用方没填)。
        if event.id.is_empty() {
            event.id = format!("act-{}", inner.next_seq);
            inner.next_seq += 1;
        } else if let Ok(n) = event.id.trim_start_matches("act-").parse::<u64>() {
            if n >= inner.next_seq {
                inner.next_seq = n + 1;
            }
        }
        // 磁盘尽力而为：目录可能为空串（in_memory 模式）→ 跳过。
        // 先持久化（借 event 引用），再 move 进缓冲，避免无谓 clone。
        if !self.root.as_os_str().is_empty() {
            if let Err(e) = self.persist_locked(&mut inner, &event) {
                tracing::warn!("[activity] persist failed: {e}");
            }
        }
        // 推入环形缓冲（驱逐最旧）。move event，无需 clone。
        if inner.buf.len() >= CAP_INMEMORY {
            inner.buf.pop_front();
        }
        inner.buf.push_back(event);
        Ok(())
    }

    /// 列出事件(按过滤条件,最新在前)。
    pub fn list(&self, filter: &ActivityFilter) -> ActivityResult<Vec<ActivityEvent>> {
        let inner = self.inner.lock();
        let limit = filter.limit.unwrap_or(100);
        let mut out: Vec<ActivityEvent> = inner
            .buf
            .iter()
            .rev()
            .filter(|e| filter.matches(e))
            .take(limit)
            .cloned()
            .collect();
        // 返回时按 ts 升序（旧 → 新），UI 可自行 reverse。
        out.reverse();
        Ok(out)
    }

    /// 搜索 mention:`@<query>` 出现在 summary 里的事件。
    ///
    /// `query` 为空时返回所有 `kind == Mention` 的事件。
    pub fn search_mentions(&self, query: &str) -> ActivityResult<Vec<ActivityEvent>> {
        let inner = self.inner.lock();
        let q = query.trim_start_matches('@').to_lowercase();
        let mut out: Vec<ActivityEvent> = inner
            .buf
            .iter()
            .rev()
            .filter(|e| {
                if q.is_empty() {
                    e.kind == ActivityKind::Mention
                } else {
                    e.summary.to_lowercase().contains(&q)
                        || e.actor.actor_id.to_lowercase().contains(&q)
                }
            })
            .take(100)
            .cloned()
            .collect();
        out.reverse();
        Ok(out)
    }

    /// 清空内存缓冲(磁盘文件不动,保留历史审计)。
    pub fn clear_memory(&self) {
        let mut inner = self.inner.lock();
        inner.buf.clear();
    }

    /// 当前内存事件数(诊断用)。
    pub fn len(&self) -> usize {
        self.inner.lock().buf.len()
    }

    /// 是否空。
    pub fn is_empty(&self) -> bool {
        self.inner.lock().buf.is_empty()
    }

    /// 把单条事件 append 到 JSONL 文件(持锁内调用)。
    ///
    /// - 延迟打开：`create_dir_all(root)` + `OpenOptions::append`。
    /// - 轮转：当前文件超过 [`ROTATE_BYTES`] 时，rename 为 `activity.<ts>.jsonl`
    ///   并开新文件。
    fn persist_locked(&self, inner: &mut Inner, event: &ActivityEvent) -> ActivityResult<()> {
        // 轮转判定（先于 open，确保新事件进新文件）。
        if inner.file.is_some() && inner.written_bytes >= ROTATE_BYTES {
            // drop 旧 writer（内部会尝试 flush），然后 rename。
            if let Some(mut w) = inner.file.take() {
                w.flush().map_err(ActivityError::io)?;
            }
            let cur = self.root.join("activity.jsonl");
            // 备份名必须未被占用：同一秒内二次轮转若直接 rename 会静默覆盖旧备份。
            std::fs::rename(&cur, self.backup_path(now_ms())).map_err(ActivityError::io)?;
            inner.written_bytes = 0;
        }
        // 延迟打开。
        if inner.file.is_none() {
            std::fs::create_dir_all(&self.root).map_err(ActivityError::io)?;
            let f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.root.join("activity.jsonl"))
                .map_err(ActivityError::io)?;
            inner.written_bytes = f.metadata().map(|m| m.len()).unwrap_or(0);
            inner.file = Some(BufWriter::new(f));
        }
        // 写一行 JSON。
        let line = serde_json::to_string(event).map_err(ActivityError::ser)?;
        let writer = inner.file.as_mut().expect("file just opened");
        let wrote = writer
            .write_all(line.as_bytes())
            .and_then(|()| writer.write_all(b"\n"))
            // 审计日志逐条落盘：BufWriter 只在缓冲区满或 drop 时 flush，
            // 进程被杀就会丢掉最近若干条记录。
            .and_then(|()| writer.flush());
        if let Err(e) = wrote {
            // 丢弃可能含半行的缓冲，下一条重新 open（append 模式不会截断）。
            inner.file = None;
            return Err(ActivityError::io(e));
        }
        inner.written_bytes += line.len() as u64 + 1;
        Ok(())
    }

    /// `activity.<ms>.jsonl`；若已存在则追加 `-<n>` 直到未被占用。
    fn backup_path(&self, stamp: u64) -> PathBuf {
        let mut suffix = 0_u32;
        loop {
            let name = if suffix == 0 {
                format!("activity.{stamp}.jsonl")
            } else {
                format!("activity.{stamp}-{suffix}.jsonl")
            };
            let candidate = self.root.join(name);
            if !candidate.exists() {
                return candidate;
            }
            suffix += 1;
        }
    }
}

/// Result 别名。
pub type ActivityResult<T> = Result<T, ActivityError>;

/// 当前毫秒时间戳。
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actor::Actor;

    fn ev(kind: ActivityKind, summary: &str, actor: Actor) -> ActivityEvent {
        ActivityEvent {
            id: String::new(),
            ts_ms: now_ms(),
            kind,
            actor,
            summary: summary.into(),
            task_id: None,
            team_name: None,
            level: ActivityLevel::Info,
        }
    }

    #[test]
    fn record_assigns_id_and_pushes() {
        let l = ActivityLogger::in_memory();
        l.record(ev(ActivityKind::TurnStarted, "hi", Actor::user()))
            .unwrap();
        assert_eq!(l.len(), 1);
        let list = l.list(&ActivityFilter::default()).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].id.starts_with("act-"));
    }

    #[test]
    fn ring_buffer_evicts_oldest() {
        let l = ActivityLogger::in_memory();
        // 填满 + 5。
        for i in 0..(CAP_INMEMORY + 5) {
            let mut e = ev(ActivityKind::AgentMessage, &format!("m{i}"), Actor::user());
            e.ts_ms = i as u64;
            l.record(e).unwrap();
        }
        assert_eq!(l.len(), CAP_INMEMORY);
        // 最旧的 m0..m4 应该被驱逐。
        let f = ActivityFilter {
            limit: Some(CAP_INMEMORY),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), CAP_INMEMORY);
        assert!(list[0].summary.contains("m5"));
    }

    #[test]
    fn filter_by_kind() {
        let l = ActivityLogger::in_memory();
        l.record(ev(ActivityKind::TaskCreated, "t1", Actor::user()))
            .unwrap();
        l.record(ev(ActivityKind::AgentMessage, "m1", Actor::user()))
            .unwrap();
        l.record(ev(ActivityKind::TaskCreated, "t2", Actor::user()))
            .unwrap();
        let f = ActivityFilter {
            kind: Some(ActivityKind::TaskCreated),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|e| e.kind == ActivityKind::TaskCreated));
    }

    #[test]
    fn filter_by_actor_id() {
        let l = ActivityLogger::in_memory();
        l.record(ev(ActivityKind::AgentMessage, "u", Actor::user()))
            .unwrap();
        l.record(ev(
            ActivityKind::AgentMessage,
            "a",
            Actor::agent("rocket", "team-lead"),
        ))
        .unwrap();
        let f = ActivityFilter {
            actor_id: Some("team-lead@rocket".into()),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].summary, "a");
    }

    #[test]
    fn filter_by_team_name() {
        let l = ActivityLogger::in_memory();
        let mut e1 = ev(
            ActivityKind::TaskCreated,
            "t1",
            Actor::agent("rocket", "builder"),
        );
        e1.team_name = Some("rocket".into());
        l.record(e1).unwrap();
        l.record(ev(ActivityKind::AgentMessage, "m", Actor::user()))
            .unwrap();
        let f = ActivityFilter {
            team_name: Some("rocket".into()),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn filter_by_since_ms() {
        let l = ActivityLogger::in_memory();
        let mut e1 = ev(ActivityKind::TaskCreated, "old", Actor::user());
        e1.ts_ms = 1000;
        l.record(e1).unwrap();
        let mut e2 = ev(ActivityKind::TaskCreated, "new", Actor::user());
        e2.ts_ms = 2000;
        l.record(e2).unwrap();
        let f = ActivityFilter {
            since_ms: Some(1500),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].summary, "new");
    }

    #[test]
    fn filter_limit_caps_results() {
        let l = ActivityLogger::in_memory();
        for i in 0..10 {
            l.record(ev(
                ActivityKind::AgentMessage,
                &format!("m{i}"),
                Actor::user(),
            ))
            .unwrap();
        }
        let f = ActivityFilter {
            limit: Some(3),
            ..Default::default()
        };
        let list = l.list(&f).unwrap();
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn search_mentions_by_query() {
        let l = ActivityLogger::in_memory();
        l.record(ev(
            ActivityKind::Mention,
            "ping @team-lead@rocket",
            Actor::user(),
        ))
        .unwrap();
        l.record(ev(
            ActivityKind::Mention,
            "ping @architect@rocket",
            Actor::user(),
        ))
        .unwrap();
        let r = l.search_mentions("team-lead").unwrap();
        assert_eq!(r.len(), 1);
        assert!(r[0].summary.contains("team-lead"));
    }

    #[test]
    fn search_mentions_empty_returns_all_mentions() {
        let l = ActivityLogger::in_memory();
        l.record(ev(ActivityKind::Mention, "@a", Actor::user()))
            .unwrap();
        l.record(ev(
            ActivityKind::AgentMessage,
            "not a mention",
            Actor::user(),
        ))
        .unwrap();
        let r = l.search_mentions("").unwrap();
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn clear_memory_empties_buf() {
        let l = ActivityLogger::in_memory();
        l.record(ev(ActivityKind::AgentMessage, "x", Actor::user()))
            .unwrap();
        assert!(!l.is_empty());
        l.clear_memory();
        assert!(l.is_empty());
    }

    #[test]
    fn level_as_str() {
        assert_eq!(ActivityLevel::Info.to_string(), "info");
        assert_eq!(ActivityLevel::Warn.to_string(), "warn");
        assert_eq!(ActivityLevel::Error.to_string(), "error");
    }

    #[test]
    fn event_serializes_camelcase() {
        let e = ev(ActivityKind::TaskCreated, "t", Actor::user());
        let v = serde_json::to_value(&e).unwrap();
        assert!(v["tsMs"].is_number());
        assert_eq!(v["kind"], "task_created");
        assert_eq!(v["level"], "info");
    }

    /// 磁盘路径必须有测试覆盖：`record` 之后从新句柄读文件，
    /// 能证明行已落盘（而不是留在 BufWriter 缓冲里）。
    #[test]
    fn record_persists_line_to_disk_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let l = ActivityLogger::new(dir.path().to_path_buf());
        l.record(ev(ActivityKind::TurnStarted, "hi", Actor::user()))
            .unwrap();
        let raw = std::fs::read_to_string(dir.path().join("activity.jsonl")).unwrap();
        let line = raw.trim_end();
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(v["summary"], "hi");
        assert_eq!(v["kind"], "turn_started");
    }

    /// 轮转备份名不得复用：同毫秒内二次轮转若覆盖旧备份即静默丢审计。
    #[test]
    fn backup_path_never_reuses_an_existing_name() {
        let dir = tempfile::tempdir().unwrap();
        let l = ActivityLogger::new(dir.path().to_path_buf());
        let first = l.backup_path(1_700_000_000_000);
        std::fs::write(&first, b"x").unwrap();
        let second = l.backup_path(1_700_000_000_000);
        assert_ne!(first, second);
        assert!(!second.exists());
    }
}
