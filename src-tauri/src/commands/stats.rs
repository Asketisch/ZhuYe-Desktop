//! 会话统计命令面。
//!
//! 薄包装 `reflect_app_core::stats`,GUI 对应 CLI `reflect session stats`:
//! 只读扫描 rollout JSONL(`~/.reflect/sessions/`)聚合出 token 用量、
//! 模型级拆分、压缩节省与记忆访问次数。

use reflect_app_core::pricing::RateCard;
use reflect_app_core::stats::{ModelUsage, SessionStats};
use reflect_protocol::ThreadId;
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

/// 查询某会话的完整统计。
///
/// 磁盘上还没有该 session 的 JSONL(刚创建、尚未发出任何消息)→ 返回
/// `null`,前端据此展示「暂无用量」而非报错。
#[tauri::command]
pub async fn reflect_session_stats(
    _agent: State<'_, MinimalAgent>,
    id: ThreadId,
) -> CommandResult<Option<SessionStats>> {
    Ok(reflect_app_core::stats::session_stats(&id))
}

/// 查询全部会话的模型级用量(按总 token 降序)。
#[tauri::command]
pub async fn reflect_all_model_usage(
    _agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<ModelUsage>> {
    Ok(reflect_app_core::stats::all_model_usage())
}

/// 查询一批模型的费率卡(让 GUI 能解释「这笔费用怎么算出来的」)。
///
/// 费率由核心的静态费率表反解(见 `app_core::pricing`),桌面端不持有
/// 第二份费率表 —— 核心更新价目后 GUI 自动跟随。模型不在表内 →
/// `priced = false`,不给编造的数字。
#[tauri::command]
pub async fn reflect_model_rate_cards(
    _agent: State<'_, MinimalAgent>,
    models: Vec<String>,
) -> CommandResult<Vec<RateCard>> {
    Ok(reflect_app_core::pricing::rate_cards(&models))
}
