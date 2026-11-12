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

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicU32;
use std::time::Duration;

use crate::discussion_events::{emit_discussion_message, message_key};

pub use crate::discussion_events::{DiscussionSessionInfo, list_discussions};
use parking_lot::Mutex;
use reflect_discussion::cli::DiscussionToml;
use reflect_discussion::llm::{build_context, prompt_for_closure};
use reflect_discussion::message_bus::MessageBus;
use reflect_discussion::models::{AgentId, DiscussionId};
use reflect_discussion::orchestrator::DiscussionOrchestrator;
use reflect_discussion::tool::DiscussionToolSet;
use reflect_llm::{ModelRegistry, SharedModelRegistry};
use reflect_protocol::{
    CollabFinishedEvent, CollabStartedEvent, EventMsg, RolloutRecorder, ThreadId, TokenUsage,
};
use reflect_subagent::SubAgentFactory;
use reflect_tools::ToolRegistry;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Collab 事件出口:调用方注入(Desktop 侧包成 `Event` 推 session broadcast)。
pub type DiscussionEventSink = Arc<dyn Fn(EventMsg) + Send + Sync>;

/// 讨论写入目标:桌面侧传入当前绑定会话的 recorder。
pub type DiscussionRecorder = Arc<dyn RolloutRecorder>;

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
    /// 调用方主动取消。
    Cancelled,
}

impl std::fmt::Display for DiscussionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiscussionError::Config(m) => write!(f, "discussion config: {m}"),
            DiscussionError::Orchestrator(m) => write!(f, "discussion orchestrator: {m}"),
            DiscussionError::Llm(m) => write!(f, "discussion llm context: {m}"),
            DiscussionError::Serialize(m) => write!(f, "discussion serialize: {m}"),
            DiscussionError::Cancelled => write!(f, "discussion cancelled"),
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

/// 运行一次多 agent 讨论(阻塞至结束;事件经 `event_sink` 转发)。
///
/// 与 CLI `reflect discussion run` 同语义:读 TOML 配置 → LLM 编排
/// (provider 可用)或 `run_noop` 降级 → 返回 transcript + result。
/// 不写输出文件(GUI 直接消费结构化返回值)。
pub async fn run_discussion(
    config_path: &Path,
    event_sink: Option<DiscussionEventSink>,
    recorder: Option<DiscussionRecorder>,
) -> Result<DiscussionRunOutcome, DiscussionError> {
    run_discussion_with_cancel(config_path, event_sink, recorder, CancellationToken::new()).await
}

/// 运行一次可由调用方取消的多 agent 讨论。
///
/// 取消令牌同时接入 `SubAgentFactory` 与 `DiscussionOrchestrator`:
/// 前者让正在流式输出的参与者停止，后者让尚未开始的调度循环直接退出。
/// 被取消时事件通道必须收到 `collab_finished { outcome: "cancelled" }`。
pub async fn run_discussion_with_cancel(
    config_path: &Path,
    event_sink: Option<DiscussionEventSink>,
    recorder: Option<DiscussionRecorder>,
    cancel: CancellationToken,
) -> Result<DiscussionRunOutcome, DiscussionError> {
    if cancel.is_cancelled() {
        return Err(DiscussionError::Cancelled);
    }
    let toml_cfg =
        DiscussionToml::load(config_path).map_err(|e| DiscussionError::Config(e.to_string()))?;
    let config = toml_cfg.clone().into_config();
    let bus = MessageBus::new(
        DiscussionId::new(),
        config.participants.clone(),
        config.mailbox_capacity,
    );
    let participants: Vec<String> = config.participants.iter().map(|p| p.0.clone()).collect();

    let (result, llm_backed) =
        match try_build_llm_orchestrator(&config, &bus, None, recorder, cancel.clone()).await {
            Some((orch, factory, toolset_usage, round_counter)) => {
                let discussion_id = bus.discussion_id();
                if let Some(sink) = &event_sink {
                    sink(EventMsg::CollabStarted(CollabStartedEvent {
                        id: discussion_id.to_string(),
                        participants: participants.clone(),
                        mode: match config.mode {
                            reflect_discussion::models::DiscussionMode::Sequential => "sequential",
                            reflect_discussion::models::DiscussionMode::Concurrent => "concurrent",
                        }
                        .into(),
                    }));
                }
                let emitted = Arc::new(Mutex::new(HashSet::new()));
                let poll_bus = bus.clone();
                let poll_sink = event_sink.clone();
                let poll_cancel = CancellationToken::new();
                let loop_cancel = poll_cancel.clone();
                let poll_emitted = emitted.clone();
                let poller = tokio::spawn(async move {
                    while !loop_cancel.is_cancelled() {
                        if let Some(sink) = &poll_sink {
                            for message in poll_bus.transcript() {
                                let key = message_key(&poll_bus.discussion_id(), &message);
                                if poll_emitted.lock().insert(key) {
                                    emit_discussion_message(
                                        sink,
                                        poll_bus.discussion_id(),
                                        &message,
                                    );
                                }
                            }
                        }
                        tokio::select! {
                                _ = loop_cancel.cancelled() => break,
                            _ = tokio::time::sleep(Duration::from_millis(20)) => {}
                        }
                    }
                });
                let ctx = match build_context(
                    factory.clone(),
                    config.topic.clone(),
                    &config.participants,
                    &toml_cfg.agents,
                    toolset_usage,
                ) {
                    Ok(ctx) => ctx,
                    Err(e) => {
                        // 提前返回前必须停掉 poller,否则任务泄漏且前端永远收不到终态事件
                        poll_cancel.cancel();
                        let _ = poller.await;
                        if let Some(sink) = &event_sink {
                            sink(EventMsg::CollabFinished(CollabFinishedEvent {
                                id: discussion_id.to_string(),
                                outcome: "failed".into(),
                                rounds: 0,
                            }));
                        }
                        return Err(DiscussionError::Llm(e.to_string()));
                    }
                };
                let result = orch.run(prompt_for_closure(ctx, bus.clone()), |_| {}).await;
                poll_cancel.cancel();
                let _ = poller.await;
                if let Some(sink) = &event_sink {
                    for message in bus.transcript() {
                        let key = message_key(&discussion_id, &message);
                        if emitted.lock().insert(key) {
                            emit_discussion_message(sink, discussion_id, &message);
                        }
                    }
                }
                let out = match result {
                    Ok(result) => {
                        let (outcome, rounds) = match &result {
                            reflect_discussion::models::DiscussionResult::Consensus {
                                final_round,
                                ..
                            } => ("consensus", final_round + 1),
                            reflect_discussion::models::DiscussionResult::NoConsensus {
                                rounds_completed,
                                ..
                            } => ("no_consensus", *rounds_completed),
                            reflect_discussion::models::DiscussionResult::Finished {
                                final_round,
                                ..
                            } => ("finished", final_round + 1),
                        };
                        if let Some(sink) = &event_sink {
                            sink(EventMsg::CollabFinished(CollabFinishedEvent {
                                id: discussion_id.to_string(),
                                outcome: outcome.into(),
                                rounds,
                            }));
                        }
                        result
                    }
                    Err(error) => {
                        let cancelled = cancel.is_cancelled();
                        if let Some(sink) = &event_sink {
                            sink(EventMsg::CollabFinished(CollabFinishedEvent {
                                id: discussion_id.to_string(),
                                outcome: if cancelled { "cancelled" } else { "failed" }.into(),
                                rounds: round_counter.load(std::sync::atomic::Ordering::SeqCst),
                            }));
                        }
                        if cancelled {
                            return Err(DiscussionError::Cancelled);
                        }
                        return Err(DiscussionError::Orchestrator(error.to_string()));
                    }
                };
                (out, true)
            }
            None => {
                tracing::warn!(
                    "no provider configured; discussion falls back to run_noop (empty transcript)"
                );
                let mode = match config.mode {
                    reflect_discussion::models::DiscussionMode::Sequential => "sequential",
                    reflect_discussion::models::DiscussionMode::Concurrent => "concurrent",
                };
                let orch =
                    DiscussionOrchestrator::new(config, bus.clone(), None, cancel.clone(), None)
                        .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?;
                let out = orch
                    .run_noop(|_| {})
                    .await
                    .map_err(|e| DiscussionError::Orchestrator(e.to_string()))?;
                if let Some(sink) = &event_sink {
                    sink(EventMsg::CollabStarted(CollabStartedEvent {
                        id: bus.discussion_id().to_string(),
                        participants: participants.clone(),
                        mode: mode.into(),
                    }));
                    sink(EventMsg::CollabFinished(CollabFinishedEvent {
                        id: bus.discussion_id().to_string(),
                        outcome: "finished".into(),
                        rounds: 0,
                    }));
                }
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

/// LLM 编排组装产物:orchestrator + 共享 factory + per-agent usage 槽。
type LlmAssembly = (
    DiscussionOrchestrator,
    Arc<SubAgentFactory>,
    HashMap<AgentId, Arc<Mutex<Option<TokenUsage>>>>,
    Arc<AtomicU32>,
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
    recorder: Option<DiscussionRecorder>,
    cancel: CancellationToken,
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
    let mut role_tools = Vec::with_capacity(config.participants.len());
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
        role_tools.push((p.0.clone(), set.registry));
    }

    // 3. SubAgentFactory + orchestrator(event_sink 桥 Collab* 事件)。
    let factory = Arc::new(SubAgentFactory::new(
        ThreadId::new(),
        resolved,
        registry,
        None,
        parent_tools,
        cancel.clone(),
        None,
    ));
    for (role, tools) in role_tools {
        factory.set_role_tools(&role, tools);
    }
    let orch = DiscussionOrchestrator::with_event_sink(
        config.clone(),
        bus.clone(),
        Some(factory.clone()),
        cancel,
        recorder,
        round_counter.clone(),
        event_sink,
    )
    .ok()?;
    Some((orch, factory, toolset_usage, round_counter))
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

        let out = match run_discussion(&cfg, Some(sink), None).await {
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
        let err = run_discussion(&path, None, None).await.unwrap_err();
        assert!(matches!(err, DiscussionError::Config(_)), "got: {err}");
    }

    #[test]
    fn list_discussions_no_filter_returns_list() {
        // 冷环境可能无 session;只断言不 panic 且返回 Vec。
        let out = list_discussions(None).unwrap();
        assert!(out.len() <= 1000);
    }
}
