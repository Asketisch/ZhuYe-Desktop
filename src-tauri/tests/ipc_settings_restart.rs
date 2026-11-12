//! 设置跨进程持久化后必须实际影响新进程中的 Agent 回合。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PHASE: &str = "REFLECT_SETTINGS_RESTART_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const TEST: &str = "saved_token_budget_applies_in_a_new_process";

fn tool_reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"settings-restart","model":"claude-mock","usage":{"input_tokens":1}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"settings_limit_tool","name":"echo"}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"text\":\"budget\"}"}}),
        ),
        (
            "content_block_stop",
            json!({"type":"content_block_stop","index":0}),
        ),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":1}}),
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

#[test]
fn saved_token_budget_applies_in_a_new_process() {
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let provider = std::fs::read_to_string(
            std::path::PathBuf::from(std::env::var_os(BASE).unwrap()).join("provider-url"),
        )
        .unwrap();
        common::invoke_ok(
            "reflect_save_config",
            json!({"toml":format!(
                "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{provider}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n[token_budget]\nsession_total_tokens = 1\n"
            )}),
        );
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
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(tool_reply(), "text/event-stream"),
            )
            .mount(&server)
            .await;
        server
    });
    let shared = tempfile::tempdir().unwrap();
    let data = shared.path().join("home/.zhuye");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(data.join("config.toml"), "[hooks]\nenabled = []\n").unwrap();
    std::fs::write(shared.path().join("provider-url"), provider.uri()).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", TEST, "--nocapture"])
        .env(PHASE, "child")
        .env(BASE, shared.path())
        .status()
        .unwrap();
    assert!(status.success(), "settings writer process failed: {status}");

    // 本二进制只有一个用例，父进程尚未初始化共享夹具。
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let config = common::invoke_ok("reflect_get_config", json!({}));
    assert!(
        config
            .as_str()
            .unwrap_or_default()
            .contains("session_total_tokens = 1"),
        "saved budget was not read back: {config}"
    );
    let rx = listen();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"settings-restart-turn","op":{"type":"user_input","items":[{"type":"text","text":"settings-restart-marker"}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    let terminal = loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("settings restart turn did not finish"));
        if event["id"] == "settings-restart-turn" && event["msg"]["type"] == "turn_complete" {
            break event;
        }
    };
    assert_eq!(
        terminal["msg"]["status"], "token_budget_exceeded",
        "persisted setting did not constrain the new process: {terminal}"
    );
    assert!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .iter()
            .any(|request| String::from_utf8_lossy(&request.body)
                .contains("settings-restart-marker")),
        "new process did not reach the configured provider"
    );
}
