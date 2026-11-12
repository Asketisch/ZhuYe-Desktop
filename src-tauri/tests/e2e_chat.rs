//! 在隔离环境中直接验证 MinimalAgent 的关闭与无模型降级事件。
//! 真模型链路由 ipc_live_free_model 和 ipc_live_capabilities 显式运行。

mod common;

use std::time::Duration;

use reflect_desktop_lib::state::MinimalAgent;
use reflect_protocol::{EventMsg, Op, Submission, UserInputItem};
use tokio::time::timeout;

fn isolated_agent() -> MinimalAgent {
    common::init_isolated_env();
    MinimalAgent::new_empty()
}

/// 端到端 #3:Op 路径。投递 Op::Shutdown,验证 Op 投递 → AgentThread →
/// ShutdownComplete 事件回流。
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn e2e_shutdown_op_propagates() {
    let agent = isolated_agent();
    agent.install_agent_thread().await;
    assert!(agent.agent_status().ready);

    let mut rx = agent.subscribe_session();

    let id = agent
        .submit_op(Op::Shutdown)
        .await
        .expect("submit_op must succeed");
    eprintln!("submit_op returned id = {id}");

    // Shutdown 应快速回流(无需 LLM)。
    let mut got_shutdown = false;
    let mut got_any = false;
    let mut types: Vec<&'static str> = Vec::new();
    let start = std::time::Instant::now();

    while start.elapsed() < Duration::from_secs(15) {
        match timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Ok(event)) => {
                got_any = true;
                let t = event.msg.discriminant();
                if !types.contains(&t) {
                    types.push(t);
                }
                if matches!(event.msg, EventMsg::ShutdownComplete) {
                    got_shutdown = true;
                    break;
                }
            }
            _ => break,
        }
    }

    assert!(got_any, "submit_op must trigger at least one event");
    eprintln!(
        "shutdown events: types={:?} got_complete={got_shutdown}",
        types
    );
    assert!(
        got_shutdown,
        "must receive ShutdownComplete after Op::Shutdown"
    );
}

/// 对照测试:无 provider 时降级路径仍产出事件。
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn e2e_degraded_mode_emits_known_event() {
    let agent = isolated_agent();
    agent.install_agent_thread().await;
    let mut rx = agent.subscribe_session();

    let submission = Submission::with_id(
        "e2e-deg-1",
        Op::UserInput {
            items: vec![UserInputItem::Text {
                text: "hello".to_string(),
            }],
            thread_settings: Default::default(),
        },
    );
    agent.submit(submission).await.expect("submit ok");

    let mut got_any = false;
    let mut types: Vec<&'static str> = Vec::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(20) {
        match timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Ok(event)) => {
                got_any = true;
                let t = event.msg.discriminant();
                if !types.contains(&t) {
                    types.push(t);
                }
                if matches!(
                    event.msg,
                    EventMsg::TurnComplete(_) | EventMsg::ShutdownComplete
                ) {
                    break;
                }
            }
            _ => break,
        }
    }
    assert!(got_any, "degraded submit must emit events");
    eprintln!("degraded events: {types:?}");
}
