//! 本地模型发起自由文本询问，回执经真实 IPC 返回模型。
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn sse(events: &[(&str, Value)]) -> String {
    events
        .iter()
        .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
        .collect()
}

fn reply(tool: bool, persistent: bool) -> String {
    let start = if tool {
        if persistent {
            json!({ "type": "tool_use", "id": "toolu_human", "name": "request_human_input" })
        } else {
            json!({ "type": "tool_use", "id": "toolu_input", "name": "ask_user" })
        }
    } else {
        json!({ "type": "text", "text": "" })
    };
    let delta = if tool {
        if persistent {
            json!({ "type": "input_json_delta", "partial_json":
                r#"{"prompt":"External answer?","context_id":"runtime-human"}"# })
        } else {
            json!({ "type": "input_json_delta", "partial_json":
                r#"{"prompt":"Enter the value:","secret":true,"placeholder":"Fixture value"}"# })
        }
    } else {
        json!({ "type": "text_delta", "text":
            if persistent { "human roundtrip complete" } else { "input roundtrip complete" } })
    };
    sse(&[
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "msg-input", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0, "content_block": start }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0, "delta": delta }),
        ),
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta",
            "delta": { "stop_reason": if tool { "tool_use" } else { "end_turn" } },
            "usage": { "output_tokens": 5 } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ])
}

fn wait_for(rx: &Receiver<Value>, seen: &mut Vec<Value>, pred: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("事件超时: {seen:#?}"));
        if pred(&event) {
            return event;
        }
        seen.push(event);
    }
}

#[test]
fn secret_input_request_and_response_reach_model() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("toolu_human"))
                    .and(body_string_contains("tool_result"))
                    .and(body_string_contains("file-answer"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(reply(false, true), "text/event-stream"),
                    )
                    .with_priority(1),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("mock-human-turn"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(reply(true, true), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("mock-input-turn"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(reply(true, false), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("toolu_input"))
                    .and(body_string_contains("tool_result"))
                    .and(body_string_contains("synthetic-value"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(reply(false, false), "text/event-stream"),
                    )
                    .with_priority(1),
            )
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\n\
         base_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": { "id": "input-submission", "op": { "type": "user_input",
                "items": [{ "type": "text", "text": "mock-input-turn" }] } }
        }),
    );
    let mut seen = Vec::new();
    let request = wait_for(&rx, &mut seen, |event| {
        event["id"] == "input-submission" && event["msg"]["type"] == "ask_user_input"
    });
    assert_eq!(request["msg"]["prompt"], "Enter the value:");
    assert_eq!(request["msg"]["secret"], true);
    assert_eq!(request["msg"]["placeholder"], "Fixture value");
    assert_eq!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .len(),
        1
    );
    common::invoke_ok(
        "reflect_ask_user_input_response",
        json!({
            "id": request["msg"]["request_id"], "text": "synthetic-value"
        }),
    );
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "input-submission" && event["msg"]["type"] == "turn_complete"
    });
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2);
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    let result = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|message| message["content"].as_array())
        .flatten()
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == "toolu_input")
        .expect("模型请求缺少输入工具结果");
    assert_eq!(result["is_error"], false);
    assert_eq!(result["content"][0]["text"], "synthetic-value");
    assert!(
        seen.iter()
            .any(|event| event["msg"]["type"] == "agent_message_delta"
                && event["msg"]["delta"] == "input roundtrip complete")
    );

    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": { "id": "human-submission", "op": { "type": "user_input",
                "items": [{ "type": "text", "text": "mock-human-turn" }] } }
        }),
    );
    let mut human_events = Vec::new();
    let human = wait_for(&rx, &mut human_events, |event| {
        event["id"] == "human-submission" && event["msg"]["type"] == "ask_user_input"
    });
    assert_eq!(human["msg"]["prompt"], "External answer?");
    let pending =
        reflect_config::paths::data_path_or_relative(&["human_input", "runtime-human.json"]);
    let answer_file =
        reflect_config::paths::data_path_or_relative(&["human_input", "runtime-human.answer.json"]);
    let pending_record: Value = serde_json::from_slice(&std::fs::read(&pending).unwrap()).unwrap();
    assert_eq!(pending_record["prompt"], "External answer?");
    std::fs::write(&answer_file, r#"{"answer":"file-answer"}"#).unwrap();
    wait_for(&rx, &mut human_events, |event| {
        event["id"] == "human-submission" && event["msg"]["type"] == "turn_complete"
    });
    assert!(!pending.exists());
    assert!(!answer_file.exists());
    assert!(
        human_events
            .iter()
            .any(|event| event["msg"]["type"] == "tool_call_end"
                && event["msg"]["call_id"] == "toolu_human"
                && event["msg"]["is_error"] == false)
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let last: Value = serde_json::from_slice(&requests.last().unwrap().body).unwrap();
    let result = last["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|message| message["content"].as_array())
        .flatten()
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == "toolu_human")
        .expect("模型请求缺少持久化人工输入结果");
    assert_eq!(result["content"][0]["text"], "file-answer");
}
