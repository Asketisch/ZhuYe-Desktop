//! Traces(LLM 调用记录)命令面。
//!
//! 薄包装 `reflect_app_core::traces`,GUI 对应 CLI `reflect traces ls / show`:
//! 只读查询 `~/.zhuye/traces/model-io/` 的脱敏 JSONL。

use reflect_app_core::traces::{SpanLogFile, TraceError, TraceSessionSummary};
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

impl From<TraceError> for super::error::CommandError {
    fn from(e: TraceError) -> Self {
        super::error::CommandError { msg: e.to_string() }
    }
}

/// 列出有 LLM 调用记录的 session(按最近降序)。
#[tauri::command]
pub async fn reflect_list_traces(
    _agent: State<'_, MinimalAgent>,
    limit: Option<usize>,
) -> CommandResult<Vec<TraceSessionSummary>> {
    Ok(reflect_app_core::traces::list_traces(
        limit.unwrap_or(reflect_app_core::traces::DEFAULT_LIMIT),
    ))
}

/// 展开某 session 的逐条 LLM 调用详情(id 支持前 8 字符前缀)。
#[tauri::command]
pub async fn reflect_get_trace(
    _agent: State<'_, MinimalAgent>,
    id: String,
) -> CommandResult<Vec<reflect_app_core::traces::TraceCall>> {
    Ok(reflect_app_core::traces::get_trace(&id)?)
}

/// 列出最近若干天的 span 日志文件(最近在前)。
///
/// span 日志是 model-io 的**姊妹**产物:记录 turn → model → tool 的
/// 父子 span 链(含耗时、状态、goal 校验事件),按天组织在
/// `~/.zhuye/traces/log/reflect-YYYY-MM-DD.jsonl`。
#[tauri::command]
pub async fn reflect_list_span_logs(
    _agent: State<'_, MinimalAgent>,
    days: Option<usize>,
) -> CommandResult<Vec<SpanLogFile>> {
    Ok(reflect_app_core::traces::list_span_logs(
        days.unwrap_or(reflect_app_core::traces::DEFAULT_SPAN_DAYS),
    ))
}

/// 读取某天 span 日志的事件(按父子关系算好树深度)。
///
/// `session_id` 缺省 = 读该天全部事件;给出时只保留该会话的。
#[tauri::command]
pub async fn reflect_read_span_log(
    _agent: State<'_, MinimalAgent>,
    day: String,
    session_id: Option<String>,
) -> CommandResult<Vec<reflect_app_core::traces::TraceSpan>> {
    Ok(reflect_app_core::traces::read_span_log(
        &day,
        session_id.as_deref(),
    ))
}
