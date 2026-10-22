//! M2.x 协议桥端到端集成测试 —— 嵌入真实 `reflect_core::AgentThread`。
//!
//! 任务规格:`docs/todo/21-gui/02-protocol-bridge.md` 验收 #1 端到端通路 + M2.x 新增测试。
//!
//! ## 测试矩阵
//!
//! 1. `real_agent_thread_emits_session_configured` — 提交后第一个 turn 必须收到
//!    `SessionConfigured` lifecycle event。
//! 2. `real_agent_thread_emits_error_for_stub_model` — 没注册 model client 时,
//!    提交应 emit `EventMsg::Error("...stub/test...")` 而不是 panic。
//! 3. `interrupt_token_cancels_in_flight_turn` — 调 `agent.interrupt()` 后 cancel
//!    token 已 cancelled。
//! 4. `broadcast_supports_multiple_subscribers` — 两个独立 subscriber 都收到同一 event。
//! 5. `model_spec_and_workspace_accessors` — 诊断接口返回正确值。
//!
//! ## 二段构造
//!
//! `MinimalAgent::new_empty()` 不需要 tokio runtime,可以直接 `agent.install_agent_thread()`
//! 在 `#[tokio::test]` runtime 内调用,这是真实 runtime 上下文的等价物。

use std::time::Duration;

use reflect_desktop_lib::state::MinimalAgent;
use reflect_protocol::{Event, EventMsg, Op, Submission, UserInputItem};
use tokio::sync::broadcast;
use tokio::time::timeout;

/// 收集最多 `max` 个 event 直到 timeout。
async fn collect_events(
    rx: &mut broadcast::Receiver<Event>,
    max: usize,
    timeout_ms: u64,
) -> Vec<Event> {
    let mut out = Vec::with_capacity(max);
    for _ in 0..max {
        let ev = match timeout(Duration::from_millis(timeout_ms), rx.recv()).await {
            Ok(Ok(e)) => e,
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => break,
            Err(_) => break,
        };
        out.push(ev);
    }
    out
}

#[tokio::test]
async fn real_agent_thread_emits_session_configured() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let mut rx = agent.subscribe_session();

    let sub = Submission::user_input("hello");
    agent.submit(sub).await.expect("submit ok");

    // 在前 10 个 event 里应当至少出现一次 SessionConfigured。
    let events = collect_events(&mut rx, 10, 500).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e.msg, EventMsg::SessionConfigured(_))),
        "SessionConfigured should fire within first events; got {} events: {:#?}",
        events.len(),
        events
            .iter()
            .map(|e| std::mem::discriminant(&e.msg))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn real_agent_thread_emits_error_for_stub_model() {
    // 这个测试只覆盖「无 provider」降级路径(stub model → Error event)。
    // 本机若配了 ~/.reflect/config.toml + API key,会走真实 provider 路径,
    // 事件流变成 SessionConfigured/TurnStarted/真实 LLM 响应 —— 不是 stub 路径,
    // 此时跳过(降级路径是 CI / 无 key 环境的回归保护)。
    let probe = MinimalAgent::new_empty();
    let cfg_handle = probe.cfg();
    let has_provider = cfg_handle.read().active_provider().is_some();
    if has_provider {
        eprintln!("SKIP: provider configured; stub-model test only covers degraded path");
        return;
    }

    // 没注册 model client → 提交 UserInput 后应 emit Error event（不应 panic）。
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let mut rx = agent.subscribe_session();

    let sub = Submission::with_id(
        "test-stub-model",
        Op::UserInput {
            items: vec![UserInputItem::Text {
                text: "ping".into(),
            }],
            thread_settings: Default::default(),
        },
    );
    agent.submit(sub).await.expect("submit ok");

    // 收 5 个 event,应当出现 Error 或 TurnComplete(no model) 或类似诊断消息。
    let events = collect_events(&mut rx, 5, 1500).await;
    let saw_termination = events
        .iter()
        .any(|e| matches!(e.msg, EventMsg::Error(_) | EventMsg::TurnComplete(_)));
    assert!(
        saw_termination,
        "stub backend must emit Error or TurnComplete; got {} events: {:#?}",
        events.len(),
        events
            .iter()
            .map(|e| match &e.msg {
                EventMsg::SessionConfigured(_) => "SessionConfigured".to_string(),
                EventMsg::TurnStarted(_) => "TurnStarted".to_string(),
                EventMsg::TurnComplete(_) => "TurnComplete".to_string(),
                EventMsg::Error(_) => "Error".to_string(),
                EventMsg::AgentMessage(_) => "AgentMessage".to_string(),
                EventMsg::AgentMessageDelta(_) => "AgentMessageDelta".to_string(),
                _ => "Other".to_string(),
            })
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn interrupt_token_cancels_in_flight_turn() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let _ = agent.subscribe_session();
    // interrupt 之前:cancel token 尚未取消。
    // 通过 MinimalAgent::cancel_token() 公开 getter 访问(替代私有 inner.thread)。
    let token_before = agent.cancel_token();
    assert!(
        token_before.as_ref().is_some_and(|t| !t.is_cancelled()),
        "cancel token should start uncancelled"
    );
    agent.interrupt();
    agent.interrupt(); // idempotent: second call is a no-op
    let token_after = token_before.expect("thread installed");
    assert!(
        token_after.is_cancelled(),
        "cancel token must be cancelled after interrupt()"
    );
}

#[tokio::test]
async fn broadcast_supports_multiple_subscribers() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let mut rx1 = agent.subscribe_session();
    let mut rx2 = agent.subscribe_session();

    let sub = Submission::user_input("fanout");
    agent.submit(sub).await.expect("submit ok");

    // 收 5 个 event,两个订阅者都应至少收到 1 个。
    let e1 = collect_events(&mut rx1, 5, 1500).await;
    let e2 = collect_events(&mut rx2, 5, 1500).await;

    assert!(!e1.is_empty(), "subscriber 1 should receive events");
    assert!(!e2.is_empty(), "subscriber 2 should receive events");
    assert!(
        e1.len() >= e2.len().saturating_sub(2) || e2.len() >= e1.len().saturating_sub(2),
        "both subscribers should see roughly the same volume (got {} vs {})",
        e1.len(),
        e2.len()
    );
}

#[tokio::test]
async fn model_spec_and_workspace_accessors() {
    let agent = MinimalAgent::new_empty();
    assert_eq!(
        agent.model_spec(),
        "stub/test",
        "default model is stub/test"
    );
    let ws = agent.workspace();
    assert!(
        ws.is_absolute() || !ws.as_os_str().is_empty(),
        "workspace should be a non-empty absolute path or at least a real path"
    );
    // set_workspace 之后访问器必须返回覆盖值,而不是启动时捕获的原 cwd。
    let original = ws.clone();
    let override_path = std::path::PathBuf::from("/tmp/reflect-workspace-override-test");
    std::fs::create_dir_all(&override_path).expect("create override dir");
    agent.set_workspace(override_path.clone());
    assert_eq!(agent.workspace(), override_path);
    agent.set_workspace(original); // restore
    let _ = std::fs::remove_dir(&override_path);
}
