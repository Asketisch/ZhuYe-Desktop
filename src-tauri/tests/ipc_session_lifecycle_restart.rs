//! 会话重命名、分叉、归档和删除在新进程中保持预期状态。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PHASE: &str = "REFLECT_SESSION_LIFECYCLE_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const TEST: &str = "session_lifecycle_survives_process_restart";

fn reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"session-lifecycle","model":"claude-mock","usage":{"input_tokens":5}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"session response"}}),
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

fn submit_and_wait(rx: &Receiver<Value>, id: &str, prompt: &str) {
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":id,"op":{"type":"user_input","items":[{"type":"text","text":prompt}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("turn {id} timed out"));
        if event["id"] == id && event["msg"]["type"] == "turn_complete" {
            return;
        }
    }
}

fn contains_session(sessions: &Value, id: &str) -> bool {
    sessions
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["session_id"] == id))
}

#[test]
fn session_lifecycle_survives_process_restart() {
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let rx = listen();
        let active = common::invoke_ok("reflect_create_session", json!({}));
        let active_id = active.as_str().unwrap();
        common::invoke_ok("reflect_bind_session", json!({"id":active}));
        submit_and_wait(&rx, "session-a-turn", "session-a-marker");
        common::invoke_ok(
            "reflect_rename_session",
            json!({"id":active,"newName":"Renamed Across Restart"}),
        );
        let fork = common::invoke_ok(
            "reflect_fork_session",
            json!({"id":active,"branch":"persisted-fork","upToTurnId":null}),
        );

        let archived = common::invoke_ok("reflect_create_session", json!({}));
        let archived_id = archived.as_str().unwrap();
        common::invoke_ok("reflect_bind_session", json!({"id":archived}));
        submit_and_wait(&rx, "session-b-turn", "session-b-marker");

        let deleted = common::invoke_ok("reflect_create_session", json!({}));
        let deleted_id = deleted.as_str().unwrap();
        common::invoke_ok("reflect_bind_session", json!({"id":deleted}));
        submit_and_wait(&rx, "session-c-turn", "session-c-marker");

        common::invoke_ok("reflect_bind_session", json!({"id":active}));
        common::invoke_ok("reflect_archive_session", json!({"id":archived}));
        common::invoke_ok("reflect_delete_session", json!({"id":deleted}));
        let ids = json!({
            "active":active_id,
            "fork":fork,
            "archived":archived_id,
            "deleted":deleted_id,
        });
        std::fs::write(
            std::path::PathBuf::from(std::env::var_os(BASE).unwrap()).join("session-ids.json"),
            serde_json::to_vec(&ids).unwrap(),
        )
        .unwrap();
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
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(), "text/event-stream"))
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
    assert!(
        status.success(),
        "session lifecycle writer failed: {status}"
    );

    // 本二进制只有一个用例，父进程尚未初始化共享夹具。
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let ids: Value =
        serde_json::from_slice(&std::fs::read(shared.path().join("session-ids.json")).unwrap())
            .unwrap();
    let active_id = ids["active"].as_str().unwrap();
    let fork_id = ids["fork"].as_str().unwrap();
    let archived_id = ids["archived"].as_str().unwrap();
    let deleted_id = ids["deleted"].as_str().unwrap();

    let active = common::invoke_ok("reflect_list_sessions", json!({}));
    assert!(contains_session(&active, active_id), "{active}");
    assert!(contains_session(&active, fork_id), "{active}");
    assert!(!contains_session(&active, archived_id), "{active}");
    assert!(!contains_session(&active, deleted_id), "{active}");
    let renamed = active
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["session_id"] == active_id)
        .unwrap();
    assert_eq!(renamed["title"], "Renamed Across Restart", "{renamed}");

    let archived = common::invoke_ok("reflect_list_archived_sessions", json!({}));
    assert!(contains_session(&archived, archived_id), "{archived}");
    assert!(!contains_session(&archived, deleted_id), "{archived}");

    let active_replay = common::invoke_ok("reflect_replay_session", json!({"id":active_id}));
    assert!(active_replay.to_string().contains("session-a-marker"));
    let fork_replay = common::invoke_ok("reflect_replay_session", json!({"id":fork_id}));
    assert!(fork_replay.to_string().contains("session-a-marker"));

    common::invoke_ok("reflect_unarchive_session", json!({"id":archived_id}));
    let archived_replay = common::invoke_ok("reflect_replay_session", json!({"id":archived_id}));
    assert!(
        archived_replay.to_string().contains("session-b-marker"),
        "{archived_replay:?}"
    );
    let active_after = common::invoke_ok("reflect_list_sessions", json!({}));
    assert!(
        contains_session(&active_after, archived_id),
        "{active_after}"
    );
    assert!(
        !contains_session(&active_after, deleted_id),
        "{active_after}"
    );
}
