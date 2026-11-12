//! 验证进程退出后人工输入文件保留，重新调用同一 context 可消费预写答案。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PHASE: &str = "REFLECT_HUMAN_RESTART_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const TEST: &str = "human_input_files_survive_restart_and_retry_consumes_answer";
const CONTEXT: &str = "restart-human-context";
const ANSWER: &str = "answer-written-after-process-exit";

struct ChildGuard(std::process::Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn reply(tool: bool) -> String {
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"human_restart_tool","name":"request_human_input"}),
            json!({"type":"input_json_delta","partial_json":json!({"prompt":"Restart answer?","context_id":CONTEXT}).to_string()}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"answer received"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"human-restart","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
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

fn submit(id: &str, prompt: &str) {
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":id,"op":{"type":"user_input","items":[{"type":"text","text":prompt}]}}}),
    );
}

fn wait_until(rx: &Receiver<Value>, id: &str, event_type: &str) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("missing {event_type}: {seen:#?}"));
        if event["id"] == id && event["msg"]["type"] == event_type {
            return seen;
        }
        seen.push(event);
    }
}

#[test]
fn human_input_files_survive_restart_and_retry_consumes_answer() {
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let rx = listen();
        let session = common::invoke_ok("reflect_create_session", json!({}));
        common::invoke_ok("reflect_bind_session", json!({"id":session}));
        let base = std::path::PathBuf::from(std::env::var_os(BASE).unwrap());
        std::fs::write(base.join("session-id"), session.as_str().unwrap()).unwrap();
        submit("human-before-restart", "ask-human-before-restart");
        wait_until(&rx, "human-before-restart", "ask_user_input");
        std::fs::write(base.join("ready"), "ready").unwrap();
        std::thread::sleep(Duration::from_secs(60));
        panic!("parent did not terminate child");
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
            .and(body_string_contains("human_restart_tool"))
            .and(body_string_contains("tool_result"))
            .and(body_string_contains(ANSWER))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply(false), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(true), "text/event-stream"))
            .with_priority(2)
            .mount(&server)
            .await;
        server
    });
    let shared = tempfile::tempdir().unwrap();
    let data = shared.path().join("home/.zhuye");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(data.join("config.toml"), format!("[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n", provider.uri())).unwrap();
    let mut child = ChildGuard(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env(PHASE, "child")
            .env(BASE, shared.path())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    while !shared.path().join("ready").exists() {
        if let Some(status) = child.0.try_wait().unwrap() {
            panic!("child exited before request: {status}");
        }
        assert!(Instant::now() < deadline, "child never requested input");
        std::thread::sleep(Duration::from_millis(25));
    }
    let session = std::fs::read_to_string(shared.path().join("session-id")).unwrap();
    let pending = data.join("human_input").join(format!("{CONTEXT}.json"));
    let answer_file = data
        .join("human_input")
        .join(format!("{CONTEXT}.answer.json"));
    let record: Value = serde_json::from_slice(&std::fs::read(&pending).unwrap()).unwrap();
    assert_eq!(record["prompt"], "Restart answer?");
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    assert!(
        pending.exists(),
        "pending request was lost when process exited"
    );
    std::fs::write(&answer_file, json!({"answer": ANSWER}).to_string()).unwrap();
    // The parent harness has not yet initialized and this binary has one test.
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let rx = listen();
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    submit("human-after-restart", "retry-human-after-restart");
    let seen = wait_until(&rx, "human-after-restart", "turn_complete");
    assert!(
        !seen
            .iter()
            .any(|e| e["id"] == "human-after-restart" && e["msg"]["type"] == "ask_user_input"),
        "prewritten answer should avoid waiting: {seen:#?}"
    );
    assert!(
        !pending.exists() && !answer_file.exists(),
        "consumed files remain"
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let matching = requests
        .iter()
        .filter_map(|request| serde_json::from_slice::<Value>(&request.body).ok())
        .any(|body| {
            body["messages"].as_array().is_some_and(|messages| {
                messages
                    .iter()
                    .filter_map(|m| m["content"].as_array())
                    .flatten()
                    .any(|block| {
                        block["type"] == "tool_result"
                            && block["tool_use_id"] == "human_restart_tool"
                            && block["is_error"] == false
                            && block["content"][0]["text"] == ANSWER
                    })
            })
        });
    assert!(
        matching,
        "answer did not reach the model as a successful tool result"
    );
}
