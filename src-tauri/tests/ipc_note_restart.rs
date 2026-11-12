//! 跨进程恢复模型写入的会话笔记，并验证恢复后的模型请求。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TEST: &str = "session_note_survives_restart_and_is_injected";
const PHASE: &str = "REFLECT_NOTE_RESTART_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const MARKER: &str = "note-survives-process-restart";

fn stream(tool: bool) -> String {
    let (block, delta, reason) = if tool {
        (
            json!({"type":"tool_use","id":"note_restart_tool","name":"add_session_note"}),
            json!({"type":"input_json_delta","partial_json":json!({"text": MARKER}).to_string()}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"done"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"note-restart","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn events() -> Receiver<Value> {
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
    let deadline = Instant::now() + Duration::from_secs(45);
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
fn session_note_survives_restart_and_is_injected() {
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let rx = events();
        let session = common::invoke_ok("reflect_create_session", json!({}));
        common::invoke_ok("reflect_bind_session", json!({"id":session}));
        common::invoke_ok("reflect_set_permission_mode", json!({"mode":"auto"}));
        let seen = submit_and_wait(&rx, "note-before-restart", "create-restart-note");
        assert!(
            seen.iter()
                .any(|event| event["msg"]["type"] == "tool_call_end"
                    && event["msg"]["call_id"] == "note_restart_tool"
                    && event["msg"]["is_error"] == false),
            "note tool did not succeed: {seen:#?}"
        );
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
        for (matcher, response, priority) in [
            ("after-restart-request", stream(false), 1),
            ("note_restart_tool", stream(false), 2),
            ("create-restart-note", stream(true), 3),
        ] {
            Mock::given(method("POST"))
                .and(path("/v1/messages"))
                .and(body_string_contains(matcher))
                .respond_with(
                    ResponseTemplate::new(200).set_body_raw(response, "text/event-stream"),
                )
                .with_priority(priority)
                .mount(&server)
                .await;
        }
        server
    });
    let shared = tempfile::tempdir().unwrap();
    let data = shared.path().join("home/.zhuye");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(data.join("config.toml"), format!("[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n", provider.uri())).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", TEST, "--nocapture"])
        .env(PHASE, "child")
        .env(BASE, shared.path())
        .status()
        .unwrap();
    assert!(status.success(), "note creation process failed: {status}");
    let session = std::fs::read_to_string(shared.path().join("session-id")).unwrap();
    // This binary contains one test; the harness has not been initialized in this process.
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let rx = events();
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let notes = common::invoke_ok("reflect_list_session_notes", json!({"id":session}));
    assert!(
        notes
            .as_array()
            .unwrap()
            .iter()
            .any(|note| note["text"] == MARKER),
        "missing persisted note: {notes}"
    );
    submit_and_wait(&rx, "note-after-restart", "after-restart-request");
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let request = requests
        .iter()
        .find(|r| String::from_utf8_lossy(&r.body).contains("after-restart-request"))
        .expect("post-restart model request");
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert!(
        body["messages"].as_array().unwrap().iter().any(|message| {
            let text = message.to_string();
            text.contains("Session Memory") && text.contains(MARKER)
        }),
        "persisted note missing from recovery message: {body}"
    );
}
