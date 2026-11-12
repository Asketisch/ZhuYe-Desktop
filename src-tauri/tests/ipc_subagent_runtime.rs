//! 本地模型通过真实 AgentThread 委派子代理并读取状态。
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply(tool: bool, text: &str) -> String {
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"toolu_delegate","name":"call_explorer"}),
            json!({"type":"input_json_delta","partial_json":"{\"prompt\":\"child-task-marker\"}"}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":text}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"subagent-test","model":"claude-mock","usage":{"input_tokens":5}}})),
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
fn model_delegates_child_result_and_queries_completed_status() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("delegate-parent-marker"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply(true, ""), "text/event-stream"),
            )
            .with_priority(3)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("child-task-marker"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(false, "child-report-fixture"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("toolu_delegate"))
            .and(body_string_contains("tool_result"))
            .and(body_string_contains("child-report-fixture"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(false, "parent-received-child"), "text/event-stream"),
            )
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
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"prompt"}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"delegate-turn", "op":{
            "type":"user_input", "items":[{"type":"text","text":"delegate-parent-marker"}]
        }}}),
    );
    let mut seen = Vec::new();
    let approval = wait_for(&rx, &mut seen, |e| {
        e["msg"]["type"] == "approval_request" && e["msg"]["kind"]["tool_name"] == "call_explorer"
    });
    common::invoke_ok(
        "reflect_tool_approval",
        json!({"id":approval["msg"]["request_id"], "decision":"approve"}),
    );
    wait_for(&rx, &mut seen, |e| {
        e["id"] == "delegate-turn" && e["msg"]["type"] == "turn_complete"
    });
    let progress = seen
        .iter()
        .find(|e| {
            e["msg"]["type"] == "subagent_progress"
                && e["msg"]["role"] == "explorer"
                && e["msg"]["text"] == "child-report-fixture"
        })
        .unwrap_or_else(|| panic!("missing child progress: {seen:#?}"));
    let child = progress["msg"]["child_id"].as_str().unwrap().to_string();
    assert!(
        seen.iter()
            .any(|e| e["msg"]["type"] == "agent_message_delta"
                && e["msg"]["delta"] == "parent-received-child")
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 3, "expected parent, child, parent requests");
    let parent: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(
        parent["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "call_explorer")
    );
    let query = common::invoke_ok("reflect_query_subagents", json!({"childId": child}));
    let snapshot = wait_for(&rx, &mut seen, |e| {
        e["id"] == query && e["msg"]["type"] == "subagent_status"
    });
    assert!(
        snapshot["msg"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["child_id"] == child
                && entry["role"] == "explorer"
                && entry["state"] == "completed"),
        "{snapshot}"
    );
    let next_session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id": next_session}));
    let query = common::invoke_ok("reflect_query_subagents", json!({"childId": child}));
    let other_session = wait_for(&rx, &mut seen, |event| {
        event["id"] == query && event["msg"]["type"] == "subagent_status"
    });
    assert_eq!(
        other_session["msg"]["children"],
        json!([]),
        "{other_session}"
    );
}
