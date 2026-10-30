use super::*;
use crate::state::MinimalAgent;

#[tokio::test]
async fn successful_model_reload_preserves_unresolved_rebind_diagnostic() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;
    *agent.inner.pending_rebind_error.lock() = Some("rebind failed".into());
    *agent.inner.degraded_reason.lock() = Some("rebind failed".into());
    let old = reflect_config::ReflectConfig::default();
    let new = cfg_with_provider("openai");
    *agent.inner.cfg.write() = new.clone();
    assert!(
        hot_reload_provider_stack(&agent, &old, &new)
            .await
            .is_none()
    );
    assert_eq!(
        agent.agent_status().degraded_reason.as_deref(),
        Some("rebind failed")
    );
}

#[test]
fn reload_diagnostics_include_all_unresolved_errors() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.pending_plugin_reload_error.lock() = Some("plugin failed".into());
    *agent.inner.pending_model_discovery_error.lock() = Some("discovery failed".into());
    *agent.inner.pending_rebind_error.lock() = Some("rebind failed".into());
    assert_eq!(
        finish_reload(&agent, vec!["discovery failed".into()]).as_deref(),
        Some("discovery failed")
    );
    assert_eq!(
        agent.agent_status().degraded_reason.as_deref(),
        Some("plugin failed; discovery failed; rebind failed")
    );
    agent.inner.pending_model_discovery_error.lock().take();
    clear_diagnostic(&agent, "discovery failed");
    assert_eq!(
        agent.agent_status().degraded_reason.as_deref(),
        Some("plugin failed; rebind failed")
    );
}

#[test]
fn unrelated_reload_keeps_existing_initialization_failure() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.degraded_reason.lock() = Some("thread initialization failed".into());
    assert!(finish_reload(&agent, vec![]).is_none());
    assert_eq!(
        agent.agent_status().degraded_reason.as_deref(),
        Some("thread initialization failed")
    );
}

fn cfg_with_provider(provider: &str) -> reflect_config::ReflectConfig {
    reflect_config::load_from_str(&format!(
        "[active]\nprovider = \"{provider}\"\n\n[{provider}]\nmodel = \"test-model\"\n"
    ))
    .expect("config parses")
}

/// 无 model 配置的 provider 快照(诚实化:spec 为 stub,降级原因给出指引)。
fn cfg_with_provider_no_model(provider: &str) -> reflect_config::ReflectConfig {
    reflect_config::load_from_str(&format!("[active]\nprovider = \"{provider}\"\n"))
        .expect("config parses")
}

/// 无关段变化不触发重载;provider 段变化触发(rebind 已绑定会话)。
#[tokio::test]
async fn hot_reload_rebuilds_registry_and_rebinds() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let sid = reflect_protocol::ThreadId::new();
    super::super::rebind::rebind_session(&agent, sid, vec![], None).unwrap();
    let thread_before = agent.inner.thread.lock().clone().unwrap();
    let registry_before = agent.inner.model_registry.lock().clone().unwrap();

    // provider 未变 → 不重建。
    let unchanged = cfg_with_provider("anthropic");
    let _ = hot_reload_provider_stack(&agent, &unchanged, &unchanged).await;
    let registry_after_same = agent.inner.model_registry.lock().clone().unwrap();
    assert!(
        std::sync::Arc::ptr_eq(&registry_before, &registry_after_same),
        "provider 段未变时不得重建 registry"
    );

    // anthropic → openai → registry 重建 + 会话强制重绑(thread Arc 换新)。
    let changed = cfg_with_provider("openai");
    let _ = hot_reload_provider_stack(&agent, &unchanged, &changed).await;
    let registry_after = agent.inner.model_registry.lock().clone().unwrap();
    let thread_after = agent.inner.thread.lock().clone().unwrap();
    assert!(
        !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
        "provider 段变化必须重建 registry"
    );
    assert!(
        !std::sync::Arc::ptr_eq(&thread_before, &thread_after),
        "已绑定会话必须强制重绑到新 registry"
    );
    assert_eq!(agent.bound_session_id(), Some(sid), "会话 id 保持不变");
    assert_eq!(
        agent.model_spec(),
        "openai/test-model",
        "model spec 随 provider 更新"
    );
}

/// 诚实化回归:provider 段变化但无任何显式 model → spec 保持 stub,
/// 降级原因给出「有 provider 但没 model」的可行动指引(而非编造
/// `openai/gpt-4o` 之类的默认模型名)。
#[tokio::test]
async fn hot_reload_without_model_reports_degraded_reason() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let old = cfg_with_provider("anthropic");
    let new = cfg_with_provider_no_model("openai");
    *agent.inner.cfg.write() = new.clone();
    let _ = hot_reload_provider_stack(&agent, &old, &new).await;
    assert_eq!(agent.model_spec(), "stub/test");
    let reason = agent.inner.degraded_reason.lock().clone();
    assert!(
        reason.as_deref().is_some_and(|r| r.contains("no model")),
        "降级原因应指向缺 model,实际: {reason:?}"
    );
}

/// provider 与 model 都齐全 → 降级原因清空。
#[tokio::test]
async fn hot_reload_with_model_clears_degraded_reason() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let old = cfg_with_provider_no_model("anthropic");
    let new = cfg_with_provider("openai");
    *agent.inner.cfg.write() = new.clone();
    let _ = hot_reload_provider_stack(&agent, &old, &new).await;
    assert_eq!(agent.model_spec(), "openai/test-model");
    assert!(agent.inner.degraded_reason.lock().is_none());
}

/// v1.5:仅 `[active].credential` 变化(同 provider 下切 coding plan)
/// 也必须触发热重载 —— 否则 GUI 的 plan 切换对运行中会话不生效。
#[tokio::test]
async fn hot_reload_detects_credential_pin_change() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let old = reflect_config::load_from_str(
        "[active]\nprovider = \"anthropic\"\n\n[anthropic]\nmodel = \"m\"\n",
    )
    .unwrap();
    let new = reflect_config::load_from_str(
        "[active]\nprovider = \"anthropic\"\ncredential = \"MiniMax\"\n\n[anthropic]\nmodel = \"m\"\n",
    )
    .unwrap();
    let registry_before = agent.inner.model_registry.lock().clone().unwrap();
    let _ = hot_reload_provider_stack(&agent, &old, &new).await;
    let registry_after = agent.inner.model_registry.lock().clone().unwrap();
    assert!(
        !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
        "钉住变化必须重建 registry(apply_to_registry 重设 preferred)"
    );
}

/// 未绑定会话时只换 registry,不建新线程。
#[tokio::test]
async fn hot_reload_without_bound_session_only_swaps_registry() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    assert!(agent.bound_session_id().is_none());
    let old = cfg_with_provider("anthropic");
    let new = cfg_with_provider("openai");
    let _ = hot_reload_provider_stack(&agent, &old, &new).await;
    assert_eq!(agent.model_spec(), "openai/test-model");
}

/// `[model_discovery]` 段变更也必须触发重载 —— 它决定 `model = "free"`
/// 从清单里挑哪个模型(开关 / 偏好 / 免费判定规则)。漏掉这一条,
/// 用户改了发现规则却要等下次切 provider 才生效。
#[tokio::test]
async fn hot_reload_detects_model_discovery_change() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let base = "[active]\nprovider = \"openai\"\n\n[openai]\nmodel = \"gpt-4o\"\n";
    let old = reflect_config::load_from_str(base).unwrap();
    let new =
        reflect_config::load_from_str(&format!("{base}\n[model_discovery]\nprefer = \"code\"\n"))
            .unwrap();
    assert_ne!(
        old.model_discovery, new.model_discovery,
        "测试前提:两边的发现段确实不同"
    );
    let registry_before = agent.inner.model_registry.lock().clone().unwrap();
    let _ = hot_reload_provider_stack(&agent, &old, &new).await;
    let registry_after = agent.inner.model_registry.lock().clone().unwrap();
    assert!(
        !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
        "发现规则变更必须重建 registry(顺带重新解析 model)"
    );
}

#[tokio::test]
async fn discovery_retries_unchanged_config_and_refreshes_changed_endpoint() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    let first = MockServer::start().await;
    let available = Arc::new(AtomicBool::new(false));
    let responder = available.clone();
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(move |_: &wiremock::Request| {
            if responder.load(Ordering::SeqCst) {
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"data": [{"id": "first-free"}]}))
            } else {
                ResponseTemplate::new(500)
            }
        })
        .mount(&first)
        .await;
    let second = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"data": [{"id": "second-free"}]})),
        )
        .mount(&second)
        .await;
    let config = |url: &str| {
        reflect_config::load_from_str(&format!(
        "[active]\nprovider = \"openai\"\n[openai]\nmodel = \"free\"\napi_key = \"test\"\nbase_url = \"{url}\"\n[model_discovery]\nalways_free = [\"first-free\", \"second-free\"]\n"
    )).unwrap()
    };
    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;
    super::super::rebind::rebind_session(&agent, reflect_protocol::ThreadId::new(), vec![], None)
        .unwrap();
    let old_thread = agent.inner.thread.lock().clone().unwrap();
    let old_registry = agent.inner.model_registry.lock().clone().unwrap();
    let old = reflect_config::ReflectConfig::default();
    let first_cfg = config(&first.uri());
    *agent.inner.cfg.write() = first_cfg.clone();
    assert!(
        hot_reload_provider_stack(&agent, &old, &first_cfg)
            .await
            .is_some()
    );
    assert_eq!(agent.model_spec(), "stub/test");
    assert!(agent.inner.pending_model_discovery_error.lock().is_some());
    assert!(Arc::ptr_eq(
        &old_thread,
        agent.inner.thread.lock().as_ref().unwrap()
    ));
    assert!(Arc::ptr_eq(
        &old_registry,
        agent.inner.model_registry.lock().as_ref().unwrap()
    ));
    super::super::rebind::rebind_session(&agent, reflect_protocol::ThreadId::new(), vec![], None)
        .unwrap();
    assert_eq!(agent.agent_status().model, "stub/test");
    available.store(true, Ordering::SeqCst);
    assert!(
        hot_reload_provider_stack(&agent, &first_cfg, &first_cfg)
            .await
            .is_none()
    );
    assert_eq!(agent.model_spec(), "openai/first-free");
    assert!(!Arc::ptr_eq(
        &old_thread,
        agent.inner.thread.lock().as_ref().unwrap()
    ));
    assert_eq!(agent.agent_status().model, "openai/first-free");
    assert!(agent.inner.pending_model_discovery_error.lock().is_none());
    let second_cfg = config(&second.uri());
    *agent.inner.cfg.write() = second_cfg.clone();
    assert!(
        hot_reload_provider_stack(&agent, &first_cfg, &second_cfg)
            .await
            .is_none()
    );
    assert_eq!(agent.model_spec(), "openai/second-free");
    available.store(false, Ordering::SeqCst);
    let startup_agent = MinimalAgent::new_empty();
    *startup_agent.inner.cfg.write() = first_cfg.clone();
    startup_agent.install_agent_thread().await;
    assert!(
        startup_agent
            .inner
            .pending_model_discovery_error
            .lock()
            .is_some()
    );
    available.store(true, Ordering::SeqCst);
    assert!(
        hot_reload_provider_stack(&startup_agent, &first_cfg, &first_cfg)
            .await
            .is_none()
    );
    assert_eq!(startup_agent.model_spec(), "openai/first-free");
}
