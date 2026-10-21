//! LLM 调用记录(traces)只读查询 —— GUI 对应 CLI `reflect traces ls / show`。
//!
//! 数据源是 `reflect-telemetry` 的 model-io JSONL(`~/.reflect/traces/model-io/`,
//! 每次 LLM 调用一条 [`ModelIoRecord`],已脱敏)。本模块只读:
//! - [`list_traces`] 列 session 摘要(调用数 / 最近时间 / 模型),
//!   session_id → 可读标题复用 rollout 自定义名 / AI 标题链;
//! - [`get_trace`] 展开某 session 的逐条调用详情。
//!
//! 与 CLI 的差异:返回结构化数据而非 stdout 表格;`get_trace` 接受完整
//! UUID 或前 8 字符前缀(与 CLI `traces show` 一致)。

use std::path::Path;

use chrono::{DateTime, Utc};
use reflect_telemetry::{
    ModelIoRecord, UsageSnapshot, list_model_io_files, read_model_io_file, resolve_traces_dir,
};
use serde::{Deserialize, Serialize};

/// 默认列出的 session 数(与 CLI `traces ls` 默认 limit 一致)。
pub const DEFAULT_LIMIT: usize = 20;

/// 默认回看多少天的 span 日志。
pub const DEFAULT_SPAN_DAYS: usize = 7;

/// traces 查询错误。
#[derive(Debug)]
pub enum TraceError {
    /// 找不到对应 session 的 model-io 文件(id 或前缀无命中)。
    SessionNotFound {
        /// 请求的 session id(或前缀)。
        id: String,
    },
    /// 前缀匹配到多个文件,无法唯一定位。
    AmbiguousPrefix {
        /// 请求的前缀。
        id: String,
        /// 命中的文件数。
        matches: usize,
    },
}

impl std::fmt::Display for TraceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TraceError::SessionNotFound { id } => {
                write!(f, "trace session not found: {id}")
            }
            TraceError::AmbiguousPrefix { id, matches } => {
                write!(f, "trace session prefix '{id}' matches {matches} files")
            }
        }
    }
}

impl std::error::Error for TraceError {}

/// 一个 session 的 traces 摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSessionSummary {
    /// session id(ThreadId uuid)。
    pub session_id: String,
    /// 可读标题(rollout 自定义名 / AI 标题 / id 前 8 字符)。
    pub title: String,
    /// 该 session 的 LLM 调用次数。
    pub calls: usize,
    /// 最近一次调用的完成时间(RFC3339)。
    pub last_at: DateTime<Utc>,
    /// 最近一次调用的模型 id。
    pub model: String,
    /// 最近一次调用的来源(`main_turn` / `subagent` / `compact` / `goal_verification`)。
    pub last_source: Option<String>,
}

/// 单次 LLM 调用详情(镜像 telemetry `ModelIoRecord`,camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceCall {
    /// 调用开始时间(RFC3339)。
    pub started_at: DateTime<Utc>,
    /// 调用完成时间(RFC3339)。
    pub completed_at: DateTime<Utc>,
    /// 耗时(毫秒)。
    pub duration_ms: u64,
    /// 重试序号(从 1 起)。
    pub attempt: u32,
    /// 唯一请求 id。
    pub request_id: String,
    /// 所属 trace id。
    pub trace_id: String,
    /// 所属 turn(可选)。
    pub turn_id: Option<String>,
    /// 调用来源(`main_turn` / `subagent` / `compact` / `goal_verification`)。
    pub query_source: String,
    /// 模型引用。
    pub model: TraceModelRef,
    /// 简化请求体(脱敏 + 截断后的元信息)。
    pub request: serde_json::Value,
    /// 简化响应体(脱敏 + 截断)。
    pub response: serde_json::Value,
    /// token 用量快照。
    pub usage: UsageSnapshot,
}

/// 模型引用(镜像 telemetry `ModelRef`)。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceModelRef {
    /// 模型 id。
    pub model_id: String,
    /// provider id(可选)。
    pub provider_id: Option<String>,
    /// 路由角色(可选)。
    pub role: Option<String>,
    /// 调用来源。
    pub source: Option<String>,
}

impl From<&reflect_telemetry::ModelRef> for TraceModelRef {
    fn from(m: &reflect_telemetry::ModelRef) -> Self {
        Self {
            model_id: m.model_id.clone(),
            provider_id: m.provider_id.clone(),
            role: m.role.clone(),
            source: m.source.clone(),
        }
    }
}

impl From<ModelIoRecord> for TraceCall {
    fn from(r: ModelIoRecord) -> Self {
        Self {
            started_at: r.started_at,
            completed_at: r.completed_at,
            duration_ms: r.duration_ms,
            attempt: r.attempt,
            request_id: r.request_id,
            trace_id: r.trace_id,
            turn_id: r.turn_id,
            query_source: r.query_source,
            model: TraceModelRef::from(&r.model),
            request: r.request,
            response: r.response,
            usage: r.usage,
        }
    }
}

/// 列出有 model-io 记录的 session(按最近修改降序,截取 `limit`)。
///
/// 标题 fallback 链与 CLI 一致:rollout 自定义名 / AI 标题 → session_id
/// 前 8 字符。rollout 列表读取失败时静默退化为前缀标题(不阻塞 traces)。
pub fn list_traces(limit: usize) -> Vec<TraceSessionSummary> {
    let base = resolve_traces_dir(None);
    let files = list_model_io_files(&base);
    let sessions = reflect_rollout::index::list_sessions(&reflect_rollout::path::default_base())
        .unwrap_or_default();

    let mut out = Vec::new();
    for (id, path, _mtime) in files.iter().take(limit) {
        let recs = read_model_io_file(path);
        let Some(last) = recs.last() else { continue };
        let title = sessions
            .iter()
            .find(|s| s.session_id.to_string() == *id)
            .and_then(|s| s.title.clone())
            .unwrap_or_else(|| id.chars().take(8).collect());
        out.push(TraceSessionSummary {
            session_id: id.clone(),
            title,
            calls: recs.len(),
            last_at: last.completed_at,
            model: last.model.model_id.clone(),
            last_source: last.model.source.clone(),
        });
    }
    out
}

/// 展开某 session 的逐条 LLM 调用(按发生顺序)。
///
/// `id` 接受完整 UUID 或前 8 字符前缀(前缀必须唯一命中)。
pub fn get_trace(id: &str) -> Result<Vec<TraceCall>, TraceError> {
    get_trace_in(&resolve_traces_dir(None), id)
}

/// [`get_trace`] 的可注入基路径版本(测试 / 自定义 traces 目录)。
pub fn get_trace_in(base: &Path, id: &str) -> Result<Vec<TraceCall>, TraceError> {
    let path = resolve_model_io_path(base, id)?;
    Ok(read_model_io_file(&path)
        .into_iter()
        .map(TraceCall::from)
        .collect())
}

/// 把完整 id 或前缀解析为 model-io 文件路径。
fn resolve_model_io_path(base: &Path, id: &str) -> Result<std::path::PathBuf, TraceError> {
    let files = list_model_io_files(base);
    if let Some((_, path, _)) = files.iter().find(|(sid, _, _)| sid == id) {
        return Ok(path.clone());
    }
    let prefix_hits: Vec<_> = files
        .iter()
        .filter(|(sid, _, _)| sid.starts_with(id))
        .collect();
    match prefix_hits.as_slice() {
        [] => Err(TraceError::SessionNotFound { id: id.to_string() }),
        [(_, path, _)] => Ok(path.clone()),
        _ => Err(TraceError::AmbiguousPrefix {
            id: id.to_string(),
            matches: prefix_hits.len(),
        }),
    }
}

// ====== Span 日志(turn → model → tool 的父子链) ======

/// 一个可用的 span 日志文件(按天)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanLogFile {
    /// 日期标识(`2026-10-01`)。
    pub day: String,
    /// 文件绝对路径。
    pub path: String,
}

/// 一条 span 事件(镜像 telemetry `TraceEvent`,camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSpan {
    /// 本 span 的 id。
    pub span_id: String,
    /// 父 span id(根节点为 None)。
    pub parent_span_id: Option<String>,
    /// 事件判别器(`turn.started` / `model.request.completed` / `tool.call.ended` …)。
    pub event: String,
    /// 发射模块(`reflect_core::submission_loop` / `reflect_goal` …)。
    pub module: String,
    /// 日志级别。
    pub level: String,
    /// span 状态(started / completed / failed)。
    pub status: Option<String>,
    /// 所属 turn。
    pub turn_id: Option<String>,
    /// 所属工具调用。
    pub tool_call_id: Option<String>,
    /// 所属会话。
    pub session_id: Option<String>,
    /// 耗时(毫秒)。
    pub duration_ms: Option<u64>,
    /// 时间戳(RFC3339)。
    pub timestamp: String,
    /// 事件特定 payload(已脱敏)。
    pub context: Option<serde_json::Value>,
    /// 树深度(0 = 根)。由 `parent_span_id` 链推导,供 UI 缩进渲染。
    pub depth: u32,
}

/// 列出最近 `days` 天内可用的 span 日志文件(最近在前)。
pub fn list_span_logs(days: usize) -> Vec<SpanLogFile> {
    let base = resolve_traces_dir(None);
    reflect_telemetry::list_span_log_files(&base, days)
        .into_iter()
        .map(|(day, path)| SpanLogFile {
            day,
            path: path.display().to_string(),
        })
        .collect()
}

/// 读取某天 span 日志的全部事件,按父子关系算出 `depth`。
///
/// `session_id` 非空时只保留该会话的事件(span 日志按天组织,一天里
/// 可能有多个会话的交错事件)。
pub fn read_span_log(day: &str, session_id: Option<&str>) -> Vec<TraceSpan> {
    let base = resolve_traces_dir(None);
    let Some((_, path)) = reflect_telemetry::list_span_log_files(&base, 30)
        .into_iter()
        .find(|(d, _)| d == day)
    else {
        return Vec::new();
    };
    let events = reflect_telemetry::read_span_log_file(&path);
    let mut spans: Vec<TraceSpan> = events
        .into_iter()
        .filter(|e| match session_id {
            Some(sid) => e.session_id.as_deref() == Some(sid),
            None => true,
        })
        .map(|e| TraceSpan {
            span_id: e.span_id,
            parent_span_id: e.parent_span_id,
            event: e.event,
            module: e.module,
            level: format!("{:?}", e.level).to_lowercase(),
            status: e.status.map(|s| format!("{s:?}").to_lowercase()),
            turn_id: e.turn_id,
            tool_call_id: e.tool_call_id,
            session_id: e.session_id,
            duration_ms: e.duration_ms,
            timestamp: e.timestamp.to_rfc3339(),
            context: e.context,
            depth: 0,
        })
        .collect();
    compute_depths(&mut spans);
    spans
}

/// 按 `parent_span_id` 链给每个 span 算树深度(0 = 根)。
///
/// 深度 = **祖先个数**:根节点 0,根的子节点 1,依此类推。
///
/// 父链缺失(父事件被按会话过滤掉,或日志跨天轮转)时,缺失的父视为根 ——
/// 该 span 深度按 0 处理。深度只用于缩进,算错不影响数据本身。
/// 父指针成环(日志异常)时以 64 层封顶,不死循环。
fn compute_depths(spans: &mut [TraceSpan]) {
    // 在场的 span id 集合 —— 用于判断「父是否存在于本集合内」。
    let present: std::collections::HashSet<String> =
        spans.iter().map(|s| s.span_id.clone()).collect();
    // 子 → 父 的映射(只含自身有父的 span)。
    let parents: std::collections::HashMap<String, String> = spans
        .iter()
        .filter_map(|s| {
            s.parent_span_id
                .as_ref()
                .map(|p| (s.span_id.clone(), p.clone()))
        })
        .collect();

    for s in spans.iter_mut() {
        let mut depth = 0u32;
        let mut cursor = s.parent_span_id.clone();
        while let Some(parent) = cursor {
            if !present.contains(&parent) {
                // 父不在本集合内 → 到此为止(缺失的父视为根)。
                break;
            }
            depth += 1;
            if depth >= 64 {
                // 环防御:日志异常时父指针可能互指。
                break;
            }
            cursor = parents.get(&parent).cloned();
        }
        s.depth = depth;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_traces_empty_dir_is_empty() {
        // 未产生任何 traces 时返回空列表而非报错(冷启动场景)。
        let out = list_traces(DEFAULT_LIMIT);
        // 本机可能有真实 traces;只断言不 panic 且 limit 生效。
        assert!(out.len() <= DEFAULT_LIMIT);
    }

    #[test]
    fn resolve_prefix_requires_unique_hit() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("model-io");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("model-io-sess_aaaa1111.jsonl"), "").unwrap();
        std::fs::write(dir.join("model-io-sess_aaaa2222.jsonl"), "").unwrap();

        // 唯一前缀命中。
        let p = resolve_model_io_path(base.path(), "aaaa1").unwrap();
        assert!(p.to_string_lossy().contains("aaaa1111"));
        // 完整 id 命中。
        let p = resolve_model_io_path(base.path(), "aaaa2222").unwrap();
        assert!(p.to_string_lossy().contains("aaaa2222"));
        // 歧义前缀报错。
        assert!(matches!(
            resolve_model_io_path(base.path(), "aaaa"),
            Err(TraceError::AmbiguousPrefix { matches: 2, .. })
        ));
        // 无命中报错。
        assert!(matches!(
            resolve_model_io_path(base.path(), "zzzz"),
            Err(TraceError::SessionNotFound { .. })
        ));
    }

    #[test]
    fn compute_depths_follows_parent_chain() {
        // turn(根) → model(1) → tool(2);兄弟节点同深度。
        let mk = |span_id: &str, parent: Option<&str>| TraceSpan {
            span_id: span_id.into(),
            parent_span_id: parent.map(|p| p.to_string()),
            event: "e".into(),
            module: "m".into(),
            level: "info".into(),
            status: None,
            turn_id: None,
            tool_call_id: None,
            session_id: None,
            duration_ms: None,
            timestamp: "2026-10-01T00:00:00Z".into(),
            context: None,
            depth: 0,
        };
        let mut spans = vec![
            mk("turn", None),
            mk("model", Some("turn")),
            mk("tool", Some("model")),
            mk("tool2", Some("model")),
        ];
        compute_depths(&mut spans);
        assert_eq!(spans[0].depth, 0, "根节点深度 0");
        assert_eq!(spans[1].depth, 1, "model 是 turn 的子节点");
        assert_eq!(spans[2].depth, 2, "tool 是 model 的子节点");
        assert_eq!(spans[3].depth, 2, "tool2 与 tool 同深度");
    }

    #[test]
    fn compute_depths_tolerates_missing_parent() {
        // 父事件被过滤掉(按会话过滤 / 跨天轮转)→ 深度按 0 处理,
        // 不崩、不无限循环。
        let mk = |span_id: &str, parent: Option<&str>| TraceSpan {
            span_id: span_id.into(),
            parent_span_id: parent.map(|p| p.to_string()),
            event: "e".into(),
            module: "m".into(),
            level: "info".into(),
            status: None,
            turn_id: None,
            tool_call_id: None,
            session_id: None,
            duration_ms: None,
            timestamp: "2026-10-01T00:00:00Z".into(),
            context: None,
            depth: 0,
        };
        let mut spans = vec![mk("child", Some("missing"))];
        compute_depths(&mut spans);
        assert_eq!(spans[0].depth, 0);
    }

    #[test]
    fn compute_depths_survives_parent_cycle() {
        // 防御:parent 指向自身 / 互指时不得死循环。
        let mk = |span_id: &str, parent: Option<&str>| TraceSpan {
            span_id: span_id.into(),
            parent_span_id: parent.map(|p| p.to_string()),
            event: "e".into(),
            module: "m".into(),
            level: "info".into(),
            status: None,
            turn_id: None,
            tool_call_id: None,
            session_id: None,
            duration_ms: None,
            timestamp: "2026-10-01T00:00:00Z".into(),
            context: None,
            depth: 0,
        };
        let mut spans = vec![mk("a", Some("b")), mk("b", Some("a"))];
        compute_depths(&mut spans);
        // 环在 64 层封顶(不死循环)。
        assert!(spans.iter().all(|s| s.depth <= 64), "{:?}", spans);
        assert!(spans.iter().any(|s| s.depth > 1), "应沿父链累计深度");
    }

    #[test]
    fn get_trace_parses_records() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("model-io");
        std::fs::create_dir_all(&dir).unwrap();
        let rec = serde_json::json!({
            "started_at": "2026-10-01T00:00:00Z",
            "completed_at": "2026-10-01T00:00:01Z",
            "duration_ms": 1000,
            "attempt": 1,
            "request_id": "r1",
            "trace_id": "t1",
            "session_id": "sess-x",
            "query_source": "main_turn",
            "model": { "model_id": "m1" },
            "request": {},
            "response": {},
            "usage": { "input_tokens": 1, "output_tokens": 2, "cached_tokens": 0,
                       "cache_write_tokens": 0, "total_tokens": 3 }
        });
        std::fs::write(
            dir.join("model-io-sess_abcd1234.jsonl"),
            format!("{}\n", serde_json::to_string(&rec).unwrap()),
        )
        .unwrap();

        let calls = get_trace_in(base.path(), "abcd1234").unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].request_id, "r1");
        assert_eq!(calls[0].usage.total_tokens, 3);
        assert_eq!(calls[0].model.model_id, "m1");
        // camelCase 出线(field 名重命名后的 serde 形状)。
        let wire = serde_json::to_value(&calls[0]).unwrap();
        assert!(wire.get("durationMs").is_some());
        assert!(wire.get("duration_ms").is_none());
    }
}
