//! 多 agent 讨论 —— GUI 对应 CLI `reflect discussion run / ls`。
//!
//! [`run_discussion`] 重组 `reflect-discussion::cli` 的 LLM 组装(provider
//! 可用时真 LLM,否则降级 `run_noop` 跑空状态机),差异仅一处:CLI 把
//! `EventMsg::Collab*` 事件写 stdout JSONL,这里经 `event_sink` 回调交给
//! 调用方(Tauri 命令层包成 `Event` 推进 MinimalAgent 的 session broadcast,
//! 前端 reducer 既有 collab_* case 实时渲染)。
//!
//! [`list_discussions`] 对应 CLI `discussion ls`:扫 rollout JSONL 中含
//! `DiscussionTranscript` 记录的 session。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicU32;

use parking_lot::Mutex;
use reflect_discussion::cli::DiscussionToml;
use reflect_discussion::llm::{build_context, prompt_for_closure};
use reflect_discussion::message_bus::MessageBus;
use reflect_discussion::models::{AgentId, DiscussionId};
use reflect_discussion::orchestrator::DiscussionOrchestrator;
use reflect_discussion::tool::DiscussionToolSet;
use reflect_llm::{ModelRegistry, SharedModelRegistry};
use reflect_protocol::{EventMsg, ThreadId, TokenUsage};
use reflect_subagent::SubAgentFactory;
use reflect_tools::ToolRegistry;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Collab 事件出口:调用方注入(Desktop 侧包成 `Event` 推 session broadcast)。
pub type DiscussionEventSink = Arc<dyn Fn(EventMsg) + Send + Sync>;

/// 讨论运行错误。
#[derive(Debug)]
pub enum DiscussionError {
    /// 配置文件读 / 解析失败。
    Config(String),
    /// 编排器构造 / 运行失败。
    Orchestrator(String),
    /// LLM 上下文组装失败(participant spec / factory)。
    Llm(String),
    /// 结果序列化失败。
    Serialize(String),
}

impl std::fmt::Display for DiscussionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiscussionError::Config(m) => write!(f, "discussion config: {m}"),
            DiscussionError::Orchestrator(m) => write!(f, "discussion orchestrator: {m}"),
            DiscussionError::Llm(m) => write!(f, "discussion llm context: {m}"),
            DiscussionError::Serialize(m) => write!(f, "discussion serialize: {m}"),
        }
    }
}

impl std::error::Error for DiscussionError {}

/// 一次讨论的运行产出。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionRunOutcome {
    /// 讨论 id(UUID)。
    pub discussion_id: String,
    /// 参与者角色列表。
    pub participants: Vec<String>,
    /// `MessageBus::format_transcript()` 的完整文本。
    pub transcript: String,
    /// `DiscussionResult` 序列化(consensus / rounds / messages 摘要)。
    pub result: serde_json::Value,
    /// 是否真 LLM 路径(false = provider 未配置,noop 空跑)。
    pub llm_backed: bool,
}

/// 历史讨论 session 条目(对应 CLI `discussion ls` 输出列)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionSessionInfo {
    /// session id(ThreadId uuid)。
    pub session_id: String,
    /// 可读标题(rollout 自定义名 / AI 标题,可能缺省)。
    pub title: Option<String>,
    /// 会话模型。
    pub model: String,
    /// 开始时间(RFC3339)。
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// 消息数。
    pub message_count: usize,
}

/// 运行一次多 agent 讨论(阻塞至结束;事件经 `event_sink` 实时流出)。
///
/// 与 CLI `reflect discussion run` 同语义:读 TOML 配置 → LLM 编排
/// (provider 可用)或 `run_noop` 降级 → 返回 transcript + result。
/// 不写输出文件(GUI 直接消费结构化返回值)。
pub async fn run_discussion(
    config_path: &Path,
    event_sink: Option<DiscussionEventSink>,
) -> Result<DiscussionRunOutcome, DiscussionError> {
    let toml_cfg =
        DiscussionToml::load(config_path).map_err(|e| DiscussionError::Config(e.to_string()))?;
    let config = toml_cfg.clone().into_config();
    let bus = MessageBus::new(
        DiscussionId::new(),
        config.participants.clone(),
        config.mailbox_capacity,
    );
    let participants: Vec<String> = config.participants.iter().map(|p| p.0.clone()).collect();

    let (result, llm_backed) = match try_build_llm_orchestrator(&config, &bus, event_sink).await {
        Some((orch, factory, toolset_usage)) => {
            let ctx = build_context(
                factory.clone(),
                config.topic.clone(),
                &config.participants,
                &toml_cfg.agents,
                toolset_usage,
            )
            .map_err(|e| DiscussionError::Llm(e.to_string()))?;
            let out = orch
                .run(prompt_for_closure(ctx, bus.clone()), |_| {})
                .await
                .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?;
            (out, true)
        }
        None => {
            tracing::warn!(
                "no provider configured; discussion falls back to run_noop (empty transcript)"
            );
            let orch = DiscussionOrchestrator::new(
                config,
                bus.clone(),
                None,
                CancellationToken::new(),
                None,
            )
            .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?;
            let out = orch
                .run_noop(|_| {})
                .await
                .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?;
            (out, false)
        }
    };

    let transcript = bus.format_transcript();
    let result_json =
        serde_json::to_value(&result).map_err(|e| DiscussionError::Serialize(e.to_string()))?;
    Ok(DiscussionRunOutcome {
        discussion_id: bus.discussion_id().to_string(),
        participants,
        transcript,
        result: result_json,
        llm_backed,
    })
}

/// 列出含讨论记录的 session。
///
/// `discussion_id = Some(id)` 时仅列包含该讨论 id 的 session;`None` 列全部
/// session(与 CLI v0.2.4 的 fallback 语义一致)。
pub fn list_discussions(
    discussion_id: Option<&str>,
) -> Result<Vec<DiscussionSessionInfo>, DiscussionError> {
    let base = reflect_rollout::path::default_base();
    let sessions = match discussion_id {
        Some(id) => reflect_rollout::index::list_sessions_with_discussion(&base, id)
            .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?,
        None => reflect_rollout::index::list_sessions(&base)
            .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?,
    };
    Ok(sessions
        .into_iter()
        .map(|s| DiscussionSessionInfo {
            session_id: s.session_id.to_string(),
            title: s.title,
            model: s.model,
            started_at: s.started_at,
            message_count: s.message_count,
        })
        .collect())
}

/// LLM 编排组装产物:orchestrator + 共享 factory + per-agent usage 槽。
type LlmAssembly = (
    DiscussionOrchestrator,
    Arc<SubAgentFactory>,
    HashMap<AgentId, Arc<Mutex<Option<TokenUsage>>>>,
);

/// LLM 编排组装 —— 镜像 `reflect_discussion::cli::try_build_llm_orchestrator`,
/// 唯一差异:event_sink 由调用方注入(CLI 是 stdout drainer,GUI 是
/// MinimalAgent session broadcast)。任一步失败返回 `None` 降级 noop。
///
/// `async`:model spec 的解析可能要打 provider 的模型清单端点
/// (`model = "free"` 这类动态值),那是网络 I/O —— 与上游 CLI 同口径。
async fn try_build_llm_orchestrator(
    config: &reflect_discussion::models::DiscussionConfig,
    bus: &MessageBus,
    event_sink: Option<DiscussionEventSink>,
) -> Option<LlmAssembly> {
    // 1. provider + model spec(全走 ReflectConfig,与 exec / GUI 线程一致)。
    //    registry 先建 —— `model = "free"` 的解析要用它当清单来源。
    let reflect_cfg = reflect_config::load_default();
    let registry: SharedModelRegistry = Arc::new(ModelRegistry::new());
    reflect_cfg.apply_to_registry(&registry).ok()?;
    let resolved = reflect_config::resolve_model_spec(&reflect_cfg, &registry)
        .await
        .ok()
        .flatten()?;

    // 2. 每 participant 一个 DiscussionToolSet(SendMessageTool 携 self_id,
    //    不能共享实例),共享 round_counter + per-agent usage 槽。
    let finished = Arc::new(Mutex::new(false));
    let round_counter = Arc::new(AtomicU32::new(0));
    let toolset_usage: HashMap<AgentId, Arc<Mutex<Option<TokenUsage>>>> = config
        .participants
        .iter()
        .map(|p| (p.clone(), Arc::new(Mutex::new(None))))
        .collect();
    let parent_tools = Arc::new(ToolRegistry::default());
    for p in &config.participants {
        let slot = toolset_usage
            .get(p)
            .cloned()
            .expect("usage map covers all participants");
        let set = DiscussionToolSet::with_usage(
            p.clone(),
            bus.clone(),
            finished.clone(),
            round_counter.clone(),
            slot,
        );
        if set.verify().is_err() {
            return None;
        }
        for name in set.tool_names() {
            if let Some(t) = set.registry.get(&name) {
                parent_tools.register(t);
            }
        }
    }

    // 3. SubAgentFactory + orchestrator(event_sink 桥 Collab* 事件)。
    let factory = Arc::new(SubAgentFactory::new(
        ThreadId::new(),
        resolved,
        registry,
        None,
        parent_tools,
        CancellationToken::new(),
        None,
    ));
    let orch = DiscussionOrchestrator::with_event_sink(
        config.clone(),
        bus.clone(),
        Some(factory.clone()),
        CancellationToken::new(),
        None,
        round_counter,
        event_sink,
    )
    .ok()?;
    Some((orch, factory, toolset_usage))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_config(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("discussion.toml");
        std::fs::write(
            &path,
            r#"
[discussion]
mode = "concurrent"
topic = "async or sync"

[[agents]]
role = "advocate"
system_prompt = "Argue for async."
allowed_tools = ["send_message", "read_messages", "finish_discussion"]

[[agents]]
role = "skeptic"
system_prompt = "Challenge the advocate."
allowed_tools = ["send_message", "read_messages", "finish_discussion"]
"#,
        )
        .unwrap();
        path
    }

    #[tokio::test]
    async fn run_discussion_noop_emits_boundary_events_and_returns_outcome() {
        // provider 可用性依环境而定,三种环境都必须有**显式断言**的合法结局:
        // 1. 无 provider(CI 裸 HOME)→ noop,llm_backed=false;
        // 2. provider 可用(REFLECT_MODEL=mock)→ llm 路径,Collab 事件成对;
        // 3. provider 配置了但不可达(开发者真实 ~/.zhuye 指向死端点)→
        //    `try_build_llm_orchestrator` 解析成功(resolve 不需要网络,
        //    静态 model id)、subagent spawn 失败 → Orchestrator/Llm 错误
        //    如实上抛 —— 这是产品语义(GUI 显式报错),不是缺陷。
        // 单测没有 HOME 沙箱注入点(`load_default` 直读 env;测试进程里
        // `set_var` 是 Rust 2024 unsafe + 多线程竞态,见 sandbox.rs),所以
        // 第三种环境在这里显式接住,而不是 unwrap panic。
        // 只有 Config / Serialize 错误才是 noop 组装路径的真缺陷。
        let dir = tempfile::tempdir().unwrap();
        let cfg = write_config(dir.path());
        let events = Arc::new(Mutex::new(Vec::<EventMsg>::new()));
        let sink_events = events.clone();
        let sink: DiscussionEventSink = Arc::new(move |evt: EventMsg| {
            sink_events.lock().push(evt);
        });

        let out = match run_discussion(&cfg, Some(sink)).await {
            Ok(out) => out,
            Err(e @ (DiscussionError::Orchestrator(_) | DiscussionError::Llm(_))) => {
                eprintln!("环境态:provider 配置了但不可用,跳过 outcome 断言: {e}");
                return;
            }
            Err(e) => panic!("讨论组装路径不应报 Config/Serialize 错误: {e}"),
        };
        assert_eq!(out.discussion_id.len(), 36, "DiscussionId 是 UUID");
        assert_eq!(
            out.participants,
            vec!["advocate".to_string(), "skeptic".to_string()]
        );
        assert!(out.result.is_object());
        if out.llm_backed {
            let started = events
                .lock()
                .iter()
                .any(|e| matches!(e, EventMsg::CollabStarted(_)));
            let finished = events
                .lock()
                .iter()
                .any(|e| matches!(e, EventMsg::CollabFinished(_)));
            assert!(started, "llm 路径必须发 CollabStarted");
            assert!(finished, "llm 路径必须发 CollabFinished");
        }
    }

    #[tokio::test]
    async fn run_discussion_bad_config_reports_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.toml");
        std::fs::write(&path, "not [valid toml").unwrap();
        let err = run_discussion(&path, None).await.unwrap_err();
        assert!(matches!(err, DiscussionError::Config(_)), "got: {err}");
    }

    #[test]
    fn list_discussions_no_filter_returns_list() {
        // 冷环境可能无 session;只断言不 panic 且返回 Vec。
        let out = list_discussions(None).unwrap();
        assert!(out.len() <= 1000);
    }
}
