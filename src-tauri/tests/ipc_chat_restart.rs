//! 聊天回合跨进程恢复：新进程回放旧会话并继续携带模型上下文。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PHASE: &str = "REFLECT_CHAT_RESTART_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const TEST: &str = "chat_history_replays_in_a_new_process";

fn reply(text: &str) -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"chat-restart","model":"claude-mock","usage":{"input_tokens":5}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
        ),
        (
            "content_block_stop",
            json!({"type":"content_block_stop","index":0}),
        ),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}),
        ),
        ("message_stop", json!({"type":"message_stop"})),
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
}

fn listen() -> Receiver<Value> {
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    rx
}

fn submit_and_wait(rx: &Receiver<Value>, id: &str, prompt: &str) -> Vec<Value> {
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":id,"op":{"type":"user_input","items":[{"type":"text","text":prompt}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("turn {id} timed out: {seen:#?}"));
        if event["id"] == id && event["msg"]["type"] == "turn_complete" {
            return seen;
        }
        seen.push(event);
    }
}

#[test]
fn chat_history_replays_in_a_new_process() {
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let rx = listen();
        let session = common::invoke_ok("reflect_create_session", json!({}));
        common::invoke_ok("reflect_bind_session", json!({"id":session}));
        submit_and_wait(&rx, "chat-before-restart", "first-process-prompt");
        let file = std::path::PathBuf::from(std::env::var_os(BASE).unwrap()).join("session-id");
        std::fs::write(file, session.as_str().unwrap()).unwrap();
        return;
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("first-process-prompt"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply("first-process-response"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("second-process-prompt"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply("second-process-response"), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        server
    });
    let shared = tempfile::tempdir().unwrap();
    let data = shared.path().join("home/.zhuye");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(
        data.join("config.toml"),
        format!(
            "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
            provider.uri()
        ),
    )
    .unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", TEST, "--nocapture"])
        .env(PHASE, "child")
        .env(BASE, shared.path())
        .status()
        .unwrap();
    assert!(status.success(), "first chat process failed: {status}");

    // 本二进制只有一个用例，父进程尚未初始化共享夹具。
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let session = std::fs::read_to_string(shared.path().join("session-id")).unwrap();
    let rx = listen();
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let replay = common::invoke_ok("reflect_replay_session", json!({"id":session}));
    let replay_text = replay.to_string();
    assert!(
        replay_text.contains("first-process-prompt")
            && replay_text.contains("first-process-response"),
        "session replay omitted the first turn: {replay:?}"
    );

    let seen = submit_and_wait(&rx, "chat-after-restart", "second-process-prompt");
    assert!(
        seen.iter().any(|event| {
            event["msg"]["type"] == "agent_message_delta"
                && event["msg"]["delta"] == "second-process-response"
        }),
        "second turn response missing: {seen:#?}"
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2, "expected one model request per process");
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    let encoded = body.to_string();
    assert!(
        encoded.contains("first-process-prompt") && encoded.contains("first-process-response"),
        "new process did not send replayed history: {body}"
    );
    assert!(encoded.contains("second-process-prompt"));
}
