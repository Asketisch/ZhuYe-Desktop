//! 模型调用任务工具和会话笔记工具，验证真实持久化与后续回合注入。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn response(tool: Option<(&str, &str, Value)>, text: &str) -> String {
    let (block, delta, stop) = match tool {
        Some((id, name, args)) => (
            json!({"type":"tool_use","id":id,"name":name}),
            json!({"type":"input_json_delta","partial_json":args.to_string()}),
            "tool_use",
        ),
        None => (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":text}),
            "end_turn",
        ),
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"task-note","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn wait_for(
    rx: &Receiver<Value>,
    seen: &mut Vec<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("event timeout: {seen:#?}"));
        if predicate(&event) {
            return event;
        }
        seen.push(event);
    }
}

#[test]
fn model_creates_task_and_note_that_desktop_can_read_and_reuse() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("task-note-first-turn"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                response(
                    Some((
                        "toolu_task",
                        "TaskCreate",
                        json!({"subject":"runtime-task", "description":"created by agent"}),
                    )),
                    "",
                ),
                "text/event-stream",
            ))
            .with_priority(5)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("toolu_task"))
            .and(body_string_contains("tool_result"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                response(
                    Some((
                        "toolu_note",
                        "add_session_note",
                        json!({"text":"runtime-note-marker"}),
                    )),
                    "",
                ),
                "text/event-stream",
            ))
            .with_priority(4)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("toolu_note"))
            .and(body_string_contains("tool_result"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                response(
                    Some(("toolu_bad_note", "add_session_note", json!({"text":"   "}))),
                    "",
                ),
                "text/event-stream",
            ))
            .with_priority(3)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("toolu_bad_note"))
            .and(body_string_contains("tool_result"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(response(None, "task-note-complete"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("task-note-second-turn"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(response(None, "second-turn-complete"), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("other-session-marker"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                response(None, "other-session-complete"),
                "text/event-stream",
            ))
            .with_priority(1)
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"auto"}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"task-note-turn-1","op":{"type":"user_input","items":[{"type":"text","text":"task-note-first-turn"}]}}}),
    );
    let mut seen = Vec::new();
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "task-note-turn-1" && event["msg"]["type"] == "turn_complete"
    });
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let first: Value = serde_json::from_slice(&requests[0].body).unwrap();
    for tool_name in [
        "TaskCreate",
        "TaskGet",
        "TaskUpdate",
        "TaskList",
        "TaskStop",
        "TaskOutput",
        "TaskClaim",
        "TaskRelease",
        "TodoWrite",
        "TeamCreate",
        "TeamDelete",
        "add_session_note",
    ] {
        assert!(
            first["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == tool_name),
            "model did not receive {tool_name}: {first}"
        );
    }
    let created = seen
        .iter()
        .find(|event| {
            event["msg"]["type"] == "tool_call_end" && event["msg"]["call_id"] == "toolu_task"
        })
        .expect("task result");
    assert_eq!(created["msg"]["is_error"], false, "{created}");
    let list = created["msg"]["output"]["metadata"]["listId"]
        .as_str()
        .unwrap();
    assert_eq!(
        list,
        session.as_str().unwrap(),
        "default task list must match the session"
    );
    let tasks = common::invoke_ok("reflect_list_tasks", json!({"list":list}));
    assert!(
        tasks
            .as_array()
            .unwrap()
            .iter()
            .any(|task| task["subject"] == "runtime-task"),
        "{tasks}"
    );
    let note = seen
        .iter()
        .find(|event| {
            event["msg"]["type"] == "tool_call_end" && event["msg"]["call_id"] == "toolu_note"
        })
        .expect("note result");
    assert_eq!(note["msg"]["is_error"], false, "{note}");
    let rejected = seen
        .iter()
        .find(|event| {
            event["msg"]["type"] == "tool_call_end" && event["msg"]["call_id"] == "toolu_bad_note"
        })
        .expect("invalid note result");
    assert_eq!(rejected["msg"]["is_error"], true, "{rejected}");
    let notes = common::invoke_ok("reflect_list_session_notes", json!({"id":session}));
    assert!(
        notes
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["text"] == "runtime-note-marker"),
        "{notes}"
    );
    assert_eq!(
        notes.as_array().unwrap().len(),
        1,
        "invalid note must not be saved: {notes}"
    );
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"task-note-turn-2","op":{"type":"user_input","items":[{"type":"text","text":"task-note-second-turn"}]}}}),
    );
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "task-note-turn-2" && event["msg"]["type"] == "turn_complete"
    });
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let second_turn = requests
        .iter()
        .find(|request| String::from_utf8_lossy(&request.body).contains("task-note-second-turn"))
        .unwrap();
    let second_body: Value = serde_json::from_slice(&second_turn.body).unwrap();
    assert!(
        second_body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| {
                let text = message.to_string();
                text.contains("Session Memory") && text.contains("runtime-note-marker")
            }),
        "note was not injected into next turn's recovery message: {second_body}"
    );
    let other_session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":other_session}));
    let other_notes = common::invoke_ok("reflect_list_session_notes", json!({"id":other_session}));
    assert_eq!(other_notes, json!([]), "notes crossed session boundaries");
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"other-session-turn","op":{"type":"user_input","items":[{"type":"text","text":"other-session-marker"}]}}}),
    );
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "other-session-turn" && event["msg"]["type"] == "turn_complete"
    });
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let other_request = requests
        .iter()
        .find(|request| String::from_utf8_lossy(&request.body).contains("other-session-marker"))
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&other_request.body).contains("runtime-note-marker"),
        "note leaked into a different session"
    );
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let restored = common::invoke_ok("reflect_list_session_notes", json!({"id":session}));
    assert_eq!(restored.as_array().unwrap().len(), 1, "{restored}");
}
