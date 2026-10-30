//! 会话统计只读查询 —— GUI 对应 CLI `reflect session stats` 与模型级用量。
//!
//! 数据源是 rollout JSONL(`$HOME/.zhuye/sessions/`),聚合**直接复用**
//! submodule 的 [`reflect_rollout::index::session_stats`] /
//! [`reflect_rollout::all_model_usage`] —— 与 CLI / SDK 同源,不在桌面端
//! 复刻 token 聚合逻辑(历史上聚合曾有三份独立实现,统计类型统一后此处
//! 只做协议形状转换)。
//!
//! v1.x 相比旧版多出三组数据:
//! - **模型级用量**(`per_model`):`RolloutRecord::TokenCount` 落盘时带
//!   `model` / `provider`,按模型分组聚合;旧 JSONL 无该字段时回退到
//!   会话级 `SessionMeta.model`。
//! - **压缩节省**(`compaction_before_tokens` / `compaction_after_tokens`):
//!   `RolloutRecord::Compaction` 落盘时带压缩前后 token 估算,回答
//!   「压缩省了多少 token」。
//! - **记忆访问审计**(`memory_reads` / `memory_writes`):
//!   `RolloutRecord::MemoryAccess` 记录检索注入与固化写入次数。

use std::path::Path;

use chrono::{DateTime, Utc};
use reflect_protocol::ThreadId;
use serde::{Deserialize, Serialize};

/// 单会话统计(camelCase 出线,桌面端 DTO 约定)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    /// 会话 id(ThreadId uuid)。
    pub session_id: String,
    /// 会话级默认模型(`SessionMeta.model`)。
    pub model: String,
    /// 会话开始时间(RFC3339)。
    pub started_at: DateTime<Utc>,
    /// 消息条数(非空行数 - 1,减去首行 SessionMeta)。
    pub message_count: usize,
    /// 工具调用次数(Assistant 消息里 ToolUse 块总数)。
    pub tool_calls: u64,
    /// 压缩次数。
    pub compactions: u64,
    /// 各次压缩前上下文 token 估算之和。
    pub compaction_before_tokens: u64,
    /// 各次压缩后上下文 token 估算之和。
    pub compaction_after_tokens: u64,
    /// 压缩累计节省的 token(before 之和 - after 之和)。
    pub compaction_tokens_saved: u64,
    /// 记忆检索注入次数。
    pub memory_reads: u64,
    /// 记忆固化写入次数。
    pub memory_writes: u64,
    /// 输入 token 累计。
    pub input_tokens: u64,
    /// 输出 token 累计。
    pub output_tokens: u64,
    /// cache_read 分段(input 子集)。
    pub cached_tokens: u64,
    /// cache_creation 分段(input 子集)。
    pub cache_write_tokens: u64,
    /// 计费总量(`input + output`)。
    pub total_tokens: u64,
    /// 累计 USD cost;`None` = 无任何带价调用。
    pub cost_usd: Option<f64>,
    /// 缓存命中率(`cached / input`);无 input 时 `None`。
    pub cache_hit_rate: Option<f64>,
    /// 按模型拆分的用量,按 `totalTokens` 降序。
    pub per_model: Vec<ModelUsage>,
}

/// 单模型累计用量(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    /// 完整 model spec(如 `"openai/gpt-4o"`)。
    pub model: String,
    /// 命中的 provider 名;`None` = 旧记录无该字段。
    pub provider: Option<String>,
    /// LLM 调用次数。
    pub calls: u64,
    /// 输入 token 累计。
    pub input_tokens: u64,
    /// 输出 token 累计。
    pub output_tokens: u64,
    /// cache_read 分段(input 子集)。
    pub cached_tokens: u64,
    /// cache_creation 分段(input 子集)。
    pub cache_write_tokens: u64,
    /// 计费总量(`input + output`;缓存分段是 input 子集,刻意不加)。
    pub total_tokens: u64,
    /// 累计 USD cost;`None` = 该模型不在 pricing 表。
    pub cost_usd: Option<f64>,
}

impl From<reflect_protocol::ModelUsage> for ModelUsage {
    fn from(u: reflect_protocol::ModelUsage) -> Self {
        Self {
            model: u.model,
            provider: u.provider,
            calls: u.calls,
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cached_tokens: u.cached_tokens,
            cache_write_tokens: u.cache_write_tokens,
            total_tokens: u.total_tokens,
            cost_usd: u.cost_usd,
        }
    }
}

impl From<reflect_protocol::SessionStats> for SessionStats {
    fn from(s: reflect_protocol::SessionStats) -> Self {
        // 先取借用型派生值,再 move 字段 —— 避免 partial move 后借用。
        let compaction_tokens_saved = s.compaction_tokens_saved();
        let cache_hit_rate = s.cache_hit_rate();
        Self {
            session_id: s.session_id.to_string(),
            model: s.model,
            started_at: s.started_at,
            message_count: s.message_count,
            tool_calls: s.tool_calls,
            compactions: s.compactions,
            compaction_before_tokens: s.compaction_before_tokens,
            compaction_after_tokens: s.compaction_after_tokens,
            compaction_tokens_saved,
            memory_reads: s.memory_reads,
            memory_writes: s.memory_writes,
            input_tokens: s.input_tokens,
            output_tokens: s.output_tokens,
            cached_tokens: s.cached_tokens,
            cache_write_tokens: s.cache_write_tokens,
            total_tokens: s.total_tokens,
            cost_usd: s.cost_usd,
            cache_hit_rate,
            per_model: s.per_model.into_iter().map(ModelUsage::from).collect(),
        }
    }
}

/// 查询某会话的完整统计(读默认 rollout 基目录)。
///
/// 磁盘上无该 session 的 JSONL(刚创建未发消息的新会话)→ `None`,
/// 由调用方决定是回空统计还是报错。
pub fn session_stats(session_id: &ThreadId) -> Option<SessionStats> {
    session_stats_in(&reflect_rollout::path::default_base(), session_id)
}

/// [`session_stats`] 的可注入基路径版本(测试用)。
pub fn session_stats_in(base: &Path, session_id: &ThreadId) -> Option<SessionStats> {
    reflect_rollout::index::session_stats(base, *session_id).map(SessionStats::from)
}

/// 全部会话的模型级用量(读默认 rollout 基目录)。
///
/// 按 `totalTokens` 降序 —— 用量最大的模型在前。
pub fn all_model_usage() -> Vec<ModelUsage> {
    all_model_usage_in(&reflect_rollout::path::default_base())
}

/// [`all_model_usage`] 的可注入基路径版本(测试用)。
pub fn all_model_usage_in(base: &Path) -> Vec<ModelUsage> {
    reflect_rollout::all_model_usage(base)
        .into_iter()
        .map(ModelUsage::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats_json() -> serde_json::Value {
        serde_json::json!({
            "type": "session_meta",
            "session_id": "11111111-2222-3333-4444-555555555555",
            "model": "openai/gpt-4o",
            "started_at": "2026-10-01T00:00:00Z",
            "workspace": "/tmp"
        })
    }

    fn token_count_json(model: &str, total: u64) -> serde_json::Value {
        // provider 取 model spec 的厂商前缀(与真实落盘形状一致)。
        let provider = model.split('/').next().unwrap_or("unknown");
        serde_json::json!({
            "type": "token_count",
            // turn_id 是 uuid newtype —— 非法 uuid 会让整行反序列化失败、
            // 被聚合器静默跳过(per_model 就空了)。
            "turn_id": "22222222-3333-4444-5555-666666666666",
            "usage": {
                "input_tokens": 100, "output_tokens": 20,
                "cached_tokens": 0, "cache_write_tokens": 0, "total_tokens": total
            },
            "cost_usd": 0.01,
            "model": model,
            "provider": provider,
            "at": "2026-10-01T00:00:01Z"
        })
    }

    fn write_session(dir: &Path, id: &str, lines: &[serde_json::Value]) {
        std::fs::create_dir_all(dir).unwrap();
        let body: String = lines
            .iter()
            .map(|l| format!("{}\n", serde_json::to_string(l).unwrap()))
            .collect();
        std::fs::write(dir.join(format!("rollout-{id}.jsonl")), body).unwrap();
    }

    #[test]
    fn session_stats_aggregates_per_model() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path();
        let id = ThreadId::parse_str("11111111-2222-3333-4444-555555555555")
            .expect("固定 uuid 应可解析");
        write_session(
            dir,
            "11111111-2222-3333-4444-555555555555",
            &[
                stats_json(),
                token_count_json("openai/gpt-4o", 120),
                token_count_json("anthropic/claude", 300),
            ],
        );

        let s = session_stats_in(dir, &id).expect("应聚合出统计");
        assert_eq!(s.model, "openai/gpt-4o");
        assert_eq!(s.per_model.len(), 2);
        // 按 totalTokens 降序 —— claude(300) 在前。
        assert_eq!(s.per_model[0].model, "anthropic/claude");
        assert_eq!(s.per_model[0].provider.as_deref(), Some("anthropic"));
        assert_eq!(s.per_model[0].calls, 1);
        assert_eq!(s.per_model[0].total_tokens, 300);
        // 第二个模型条目按 totalTokens 降序在后。
        assert_eq!(s.per_model[1].model, "openai/gpt-4o");
        assert_eq!(s.per_model[1].provider.as_deref(), Some("openai"));
        // camelCase 出线。
        let wire = serde_json::to_value(&s).unwrap();
        assert!(wire.get("perModel").is_some());
        assert!(wire.get("per_model").is_none());
    }

    #[test]
    fn session_stats_missing_session_is_none() {
        let base = tempfile::tempdir().unwrap();
        let id = ThreadId::new();
        assert!(session_stats_in(base.path(), &id).is_none());
    }

    #[test]
    fn all_model_usage_empty_base_is_empty() {
        let base = tempfile::tempdir().unwrap();
        assert!(all_model_usage_in(base.path()).is_empty());
    }
}
