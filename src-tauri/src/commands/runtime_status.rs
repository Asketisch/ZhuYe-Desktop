//! 运行时状态只读面 —— 让「系统此刻到底怎么了」在 GUI 里可见。
//!
//! 这些能力基座都有、GUI 此前一个都看不到:
//! - **凭证池健康度** —— failover 发生了,却看不出哪个凭证在冷却、池里
//!   还剩几个能用;
//! - **已完成的子代理调用** —— 压缩后「刚才跑了哪些子代理、结论是什么」
//!   答不出(核心把它记在 `SubagentRegistry`,但 GUI 读不到);
//! - **记忆分段** —— GUI 显示的是整份 MEMORY.md 原文,agent 实际吃到的是
//!   按 `## ` 切分 + 相关性筛选后的条目;
//! - **配置位置与分析健康度** —— 手改 `config.toml` 后不知道应用读的是
//!   哪个文件、分析上报是否正常。

use reflect_protocol::ThreadId;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// 单个 provider 的凭证池健康度(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialPoolStatus {
    /// provider 名(`anthropic` / `openai` / `ollama`)。
    pub provider: String,
    /// 池内凭证总数(含顶层 `api_key` 的隐式条目)。
    pub total: usize,
    /// 当前**未处于冷却**的凭证数。
    pub healthy: usize,
    /// 健康凭证的 label 列表。
    pub healthy_labels: Vec<String>,
}

/// 查询各 provider 的凭证池健康度。
///
/// 「总数 − 健康数」= 处于冷却中的凭证数(核心的 cooldown 集合是私有
/// 字段,只能从健康集合反推)。冷却原因(429 / 401 / 5xx)在核心内不公开,
/// 此处不编造。
#[tauri::command]
pub async fn reflect_credential_pool_status(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<CredentialPoolStatus>> {
    let cfg = agent.inner.cfg.read().clone();
    let registry = agent.inner.model_registry.lock().clone();

    let mut out: Vec<CredentialPoolStatus> = Vec::new();
    // provider 段是 `Option<Section>` —— 未配置时整段为空。
    let sections: [(
        &str,
        Option<&reflect_config::AnthropicSection>,
        Option<&reflect_config::OpenAISection>,
        Option<&reflect_config::OllamaSection>,
    ); 3] = [
        ("anthropic", cfg.anthropic.as_ref(), None, None),
        ("openai", None, cfg.openai.as_ref(), None),
        ("ollama", None, None, cfg.ollama.as_ref()),
    ];
    for (provider, anthropic, openai, ollama) in sections {
        // 各 provider 段形状一致(隐式 api_key + credentials 列表)。
        let (has_key, creds): (bool, usize) = match (anthropic, openai, ollama) {
            (Some(s), _, _) => (s.api_key.is_some(), s.credentials.len()),
            (_, Some(s), _) => (s.api_key.is_some(), s.credentials.len()),
            (_, _, Some(s)) => (s.api_key.is_some(), s.credentials.len()),
            _ => (false, 0),
        };
        // 顶层 `api_key` 隐式条目的 label 固定为 "default"(见 builder)。
        let total = usize::from(has_key) + creds;
        if total == 0 {
            continue;
        }
        let healthy_labels: Vec<String> = match registry.as_ref() {
            Some(reg) => reg
                .healthy_clients(&format!("{provider}/any"))
                .into_iter()
                .map(|c| c.label)
                .collect(),
            None => Vec::new(),
        };
        out.push(CredentialPoolStatus {
            provider: provider.to_string(),
            total,
            healthy: healthy_labels.len(),
            healthy_labels,
        });
    }
    Ok(out)
}

/// 一条已完成的子代理调用(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentCallRecord {
    /// 工具名(`call_<role>`)。
    pub tool_name: String,
    /// 任务摘要。
    pub task_summary: String,
    /// 结果摘要。
    pub result_summary: String,
    /// 触发的迭代序号。
    pub iteration: u32,
    /// 写入时间(RFC3339)。
    pub created_at: String,
}

/// 查询本会话已完成的子代理调用(core 的 `SubagentRegistry` 快照)。
///
/// registry 挂在 `M4Deps` 上,`CallSubAgentTool` 写、`pre_loop` 读 ——
/// 它回答「agent 刚才派了哪些子代理、结论是什么」。
#[tauri::command]
pub async fn reflect_recovery_state(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<SubagentCallRecord>> {
    let thread = agent.inner.thread.lock().clone();
    let Some(thread) = thread else {
        return Ok(Vec::new());
    };
    let Some(m4) = thread.config().m4.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(m4
        .subagent_registry
        .snapshot()
        .into_iter()
        .map(|e| SubagentCallRecord {
            tool_name: e.tool_name,
            task_summary: e.task_summary,
            result_summary: e.result_summary,
            iteration: e.iteration,
            created_at: e.created_at.to_rfc3339(),
        })
        .collect())
}

/// 记忆的一个分段(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySectionInfo {
    /// scope(`project` / `user`)。
    pub scope: String,
    /// `## ` 标题;无标题条目为空串。
    pub title: String,
    /// 正文。
    pub body: String,
    /// 文件内序号(0-based,保持原顺序)。
    pub index: usize,
    /// 正文字符数 —— 与 8000 字注入预算对照可见。
    pub chars: usize,
}

/// 查询记忆的**分段**视图(与 agent 实际注入的结构一致)。
///
/// 核心注入的是「按 `## ` 切分 + BM25 相关性筛选后」的条目,不是整份
/// MEMORY.md 原文。GUI 此前只显示原文,用户无法知道 agent 实际记住了
/// 哪几条。
#[tauri::command]
pub async fn reflect_memory_sections(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<MemorySectionInfo>> {
    let entries = agent
        .list_memory()
        .map_err(crate::commands::error::CommandError::from)?;
    let mut out: Vec<MemorySectionInfo> = Vec::new();
    for entry in entries {
        let scope = match entry.scope.as_str() {
            "project" => reflect_memory::MemoryScope::Project,
            "user" => reflect_memory::MemoryScope::User,
            _ => continue,
        };
        for sec in reflect_memory::split_sections(scope, &entry.value) {
            out.push(MemorySectionInfo {
                scope: entry.scope.clone(),
                title: sec.title,
                chars: sec.body.chars().count(),
                body: sec.body,
                index: sec.index,
            });
        }
    }
    Ok(out)
}

/// 配置文件与分析上报的状态(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInfo {
    /// 配置文件绝对路径;HOME 缺失时为 null。
    pub path: Option<String>,
    /// 配置文件是否实际存在。
    pub exists: bool,
    /// 分析上报是否启用。
    pub analytics_enabled: bool,
    /// 核心给出的分析状态描述(一行)。
    pub analytics_status: String,
    /// 当前工作区目录。
    pub workspace: String,
    /// 当前活跃 agent 名。
    pub active_agent: String,
}

/// 查询配置位置与分析健康度。
///
/// 手改 `config.toml` 的用户需要知道「应用读的是哪个文件」;分析上报
/// 是否正常也应有可见面。
#[tauri::command]
pub async fn reflect_config_info(agent: State<'_, MinimalAgent>) -> CommandResult<ConfigInfo> {
    let cfg = agent.inner.cfg.read().clone();
    let path = reflect_config::default_config_path();
    Ok(ConfigInfo {
        exists: path.as_ref().is_some_and(|p| p.exists()),
        path: path.map(|p| p.display().to_string()),
        analytics_enabled: cfg
            .analytics
            .as_ref()
            .and_then(|a| a.enabled)
            .unwrap_or(false),
        analytics_status: reflect_config::analytics::status_line(cfg.analytics.as_ref()),
        workspace: agent.workspace().display().to_string(),
        active_agent: crate::agent_state::AgentState::active_agent(),
    })
}

/// 供测试用:构造一个 ThreadId(避免各处重复 parse)。
#[allow(dead_code)]
fn test_thread_id() -> ThreadId {
    ThreadId::new()
}
